import { expect, it } from "bun:test";
import Redis from "ioredis";
const redis = process.env.WEBLINK_TEST_REDIS_URL;
(redis ? it : it.skip)(
  "rejects a same-ID candidate on another signaling node without interrupting the owner",
  async () => {
    const ports = [21400 + (process.pid % 1000), 22400 + (process.pid % 1000)];
    const processes = ports.map((port) =>
      Bun.spawn(["bun", "src/index.ts"], {
        cwd: import.meta.dir + "/..",
        env: {
          ...process.env,
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
          LOG_LEVEL: "silent",
          REDIS_URL: redis!,
          HEARTBEAT_INTERVAL: "60000",
          PONG_TIMEOUT: "120000",
          DISCONNECT_TIMEOUT: "90000",
        },
        stdout: "ignore",
        stderr: "pipe",
      }),
    );
    const sockets: WebSocket[] = [];
    const room = crypto.randomUUID();
    const redisCheck = new Redis(redis!);
    async function subscribed(count: number) {
      const deadline = Date.now() + 5000;
      while (true) {
        const result = await redisCheck.pubsub("NUMSUB", `room:${room}`);
        if (Number(result[1]) >= count) return;
        if (Date.now() > deadline)
          throw new Error("Room subscription not ready");
        await Bun.sleep(10);
      }
    }
    async function connect(port: number) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}`);
      sockets.push(socket);
      const frames: any[] = [];
      socket.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
      const next = async () => {
        const deadline = Date.now() + 3000;
        while (!frames.length) {
          if (Date.now() > deadline) throw new Error("Missing cluster message");
          await Bun.sleep(5);
        }
        return frames.shift();
      };
      const ready = await next();
      expect(ready.type).toBe("connected");
      return {
        socket,
        next,
        challenge: ready.identityChallenge,
        send: (value: unknown) => socket.send(JSON.stringify(value)),
      };
    }
    async function join(peer: Awaited<ReturnType<typeof connect>>, id: string) {
      const key = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      const b64 = (b: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(b)));
      const createdAt = Date.now();
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        new TextEncoder().encode(
          JSON.stringify([
            "weblink-signaling-identity/1",
            peer.challenge,
            id,
            createdAt,
          ]),
        ),
      );
      peer.send({
        type: "join",
        data: {
          clientId: id,
          createdAt,
          identityProof: {
            publicKey: b64(await crypto.subtle.exportKey("raw", key.publicKey)),
            signature: b64(signature),
          },
        },
      });
    }
    try {
      for (const port of ports) {
        const deadline = Date.now() + 5000;
        while (true) {
          try {
            if ((await fetch(`http://127.0.0.1:${port}/healthcheck`)).ok) break;
          } catch {}
          if (Date.now() > deadline)
            throw new Error("Cluster server not ready");
          await Bun.sleep(20);
        }
      }
      const owner = await connect(ports[0]);
      await subscribed(1);
      await join(owner, "owner");
      expect((await owner.next()).type).toBe("joined");
      const watcher = await connect(ports[1]);
      // Wait for subscription acknowledgements, not a timing assumption.
      await subscribed(2);
      await join(watcher, "watcher");
      expect((await watcher.next()).type).toBe("joined");
      expect(await watcher.next()).toMatchObject({
        type: "join",
        data: { clientId: "owner" },
      });
      const attacker = await connect(ports[1]);
      await join(attacker, "owner");
      expect(await attacker.next()).toMatchObject({
        type: "error",
        data: "DUPLICATE_DEVICE_ID",
      });
      owner.send({
        type: "message",
        data: {
          type: "candidate",
          clientId: "owner",
          targetClientId: "watcher",
          data: "still-alive",
        },
      });
      expect(await watcher.next()).toMatchObject({
        type: "message",
        data: { data: "still-alive" },
      });
      expect(owner.socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      redisCheck.disconnect();
      sockets.forEach((s) => s.close());
      processes.forEach((p) => p.kill("SIGINT"));
      await Promise.all(processes.map((p) => p.exited));
    }
  },
  15000,
);
