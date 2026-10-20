import { expect, it } from "bun:test";
import Redis from "ioredis";
const redis = process.env.WEBLINK_TEST_REDIS_URL;
(redis ? it : it.skip).each([true, false])(
  "protects signed owners while allowing legacy cross-node reconnects (signed=%s)",
  async (withIdentity) => {
    const room = crypto.randomUUID();
    const connectionName = `weblink-test-${room}`;
    const serverRedisUrl = new URL(redis!);
    serverRedisUrl.searchParams.set("connectionName", connectionName);
    const ports = [21400 + (process.pid % 1000), 22400 + (process.pid % 1000)];
    const processes = ports.map((port) =>
      Bun.spawn(["bun", "src/index.ts"], {
        cwd: import.meta.dir + "/..",
        env: {
          ...process.env,
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
          LOG_LEVEL: "info",
          NODE_ENV: "production",
          REDIS_URL: serverRedisUrl.href,
          HEARTBEAT_INTERVAL: "60000",
          PONG_TIMEOUT: "120000",
          DISCONNECT_TIMEOUT: "90000",
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const diagnostics = processes.map(async (p) =>
      (
        await Promise.all([
          new Response(p.stdout).text(),
          new Response(p.stderr).text(),
        ])
      ).join("\n"),
    );
    let failed = false;
    const sockets: WebSocket[] = [];
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
      if (!withIdentity) {
        peer.send({
          type: "join",
          data: { clientId: id, createdAt: Date.now(), resume: true },
        });
        return;
      }
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
      // Disconnect only this fixture's subscriber connections. Membership and
      // forwarding must survive Redis reconnects without rejoining the room.
      const subscribers = String(
        await redisCheck.client("LIST", "TYPE", "pubsub"),
      )
        .trim()
        .split("\n")
        .map((line) =>
          Object.fromEntries(line.split(" ").map((field) => field.split("="))),
        )
        .filter((client) => client.name === connectionName);
      expect(subscribers).toHaveLength(2);
      for (const client of subscribers)
        await redisCheck.client("KILL", "ID", client.id);
      await subscribed(2);
      const attacker = await connect(ports[1]);
      await join(attacker, "owner");
      if (withIdentity) {
        expect(await attacker.next()).toMatchObject({
          type: "error",
          data: "DUPLICATE_DEVICE_ID",
        });
      } else {
        expect(await attacker.next()).toMatchObject({
          type: "joined",
          data: { resumed: false },
        });
        expect(await attacker.next()).toMatchObject({
          type: "join",
          data: { clientId: "watcher" },
        });
        expect(await watcher.next()).toMatchObject({
          type: "join",
          data: { clientId: "owner" },
        });
        const deadline = Date.now() + 3000;
        while (owner.socket.readyState !== WebSocket.CLOSED) {
          if (Date.now() > deadline)
            throw new Error("Old legacy owner stayed open");
          await Bun.sleep(5);
        }
      }
      const current = withIdentity ? owner : attacker;
      current.send({
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
      expect(current.socket.readyState).toBe(WebSocket.OPEN);
      watcher.send({
        type: "message",
        data: {
          type: "answer",
          clientId: "watcher",
          targetClientId: "owner",
          data: "reply-after-reconnect",
        },
      });
      // The original owner still has the watcher's initial join queued.
      if (withIdentity) expect((await owner.next()).type).toBe("join");
      expect(await current.next()).toMatchObject({
        type: "message",
        data: { data: "reply-after-reconnect" },
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      redisCheck.disconnect();
      sockets.forEach((s) => s.close());
      processes.forEach((p) => p.kill("SIGINT"));
      await Promise.all(processes.map((p) => p.exited));
      const output = await Promise.all(diagnostics);
      if (failed)
        console.error(
          output.join("\n").replaceAll(serverRedisUrl.href, "<test-redis>"),
        );
    }
  },
  15000,
);
