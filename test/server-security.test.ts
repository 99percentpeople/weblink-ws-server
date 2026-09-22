import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { RawSignal, TransferClient } from "../src/types";

interface SocketCloseInfo {
  code: number;
  reason: string;
}

class SocketInbox {
  private readonly queued: RawSignal[] = [];
  private readonly waiting: Array<(signal: RawSignal) => void> = [];
  private closeEvent: SocketCloseInfo | null = null;
  private readonly closeWaiting: Array<(event: SocketCloseInfo) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const signal = JSON.parse(String(event.data)) as RawSignal;
      const resolve = this.waiting.shift();
      if (resolve) {
        resolve(signal);
      } else {
        this.queued.push(signal);
      }
    });

    socket.addEventListener("close", (event) => {
      const closeEvent: SocketCloseInfo = {
        code: event.code,
        reason: event.reason,
      };
      this.closeEvent = closeEvent;
      for (const resolve of this.closeWaiting.splice(0)) {
        resolve(closeEvent);
      }
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for WebSocket open"));
      }, 2_000);
      this.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      this.socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket failed to open"));
        },
        { once: true },
      );
    });
  }

  send(signal: RawSignal): void {
    this.socket.send(JSON.stringify(signal));
  }

  async next(): Promise<RawSignal> {
    const queued = this.queued.shift();
    if (queued) return queued;

    return new Promise<RawSignal>((resolve, reject) => {
      const onSignal = (signal: RawSignal) => {
        clearTimeout(timeout);
        resolve(signal);
      };
      const timeout = setTimeout(() => {
        const index = this.waiting.indexOf(onSignal);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        reject(new Error("Timed out waiting for WebSocket message"));
      }, 2_000);
      this.waiting.push(onSignal);
    });
  }

  async closed(): Promise<SocketCloseInfo> {
    if (this.closeEvent) return this.closeEvent;

    return new Promise<SocketCloseInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.closeWaiting.indexOf(onClose);
        if (index !== -1) {
          this.closeWaiting.splice(index, 1);
        }
        reject(new Error("Timed out waiting for WebSocket close"));
      }, 2_000);
      const onClose = (event: SocketCloseInfo) => {
        clearTimeout(timeout);
        resolve(event);
      };
      this.closeWaiting.push(onClose);
    });
  }

  close(): void {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(1000, "test complete");
    }
  }
}

const port = 19_400 + (process.pid % 1_000);
const httpBase = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;
const sockets: SocketInbox[] = [];
let serverProcess: Pick<ReturnType<typeof Bun.spawn>, "kill" | "exited">;

function client(
  clientId: string,
  options: Partial<TransferClient> = {},
): TransferClient {
  return {
    clientId,
    createdAt: options.createdAt ?? Date.now(),
    rtcProfileVersion: options.rtcProfileVersion,
    resume: options.resume,
  };
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${httpBase}/healthcheck`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await Bun.sleep(20);
  }
  throw new Error("Server did not start");
}

async function connect(roomId: string): Promise<SocketInbox> {
  const url = new URL(wsBase);
  url.searchParams.set("room", roomId);
  const inbox = new SocketInbox(new WebSocket(url.toString()));
  sockets.push(inbox);
  await inbox.opened();
  return inbox;
}

async function join(inbox: SocketInbox, value: unknown): Promise<RawSignal> {
  inbox.send({
    type: "join",
    data: value,
  });
  const acknowledgement = await inbox.next();
  expect(acknowledgement).toMatchObject({
    type: "joined",
    data: {
      protocolVersion: 2,
      resumed: expect.any(Boolean),
    },
  });
  return acknowledgement;
}

beforeAll(async () => {
  serverProcess = Bun.spawn(["bun", "src/index.ts"], {
    cwd: import.meta.dir + "/..",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      LOG_LEVEL: "silent",
      HEARTBEAT_INTERVAL: "60000",
      PONG_TIMEOUT: "120000",
      DISCONNECT_TIMEOUT: "90000",
      REDIS_URL: "",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  await waitForServer();
});

afterAll(async () => {
  for (const inbox of sockets.splice(0)) {
    inbox.close();
  }
  serverProcess.kill("SIGINT");
  await serverProcess.exited;
});

describe("WebSocket server security limits", () => {
  it("rejects invalid room and password hash lengths during upgrade", async () => {
    const emptyRoom = await fetch(`${httpBase}/?room=`, {
      headers: { Upgrade: "websocket" },
    });
    expect(emptyRoom.status).toBe(400);
    expect(await emptyRoom.text()).toBe("Invalid room");

    const oversizedRoom = await fetch(`${httpBase}/?room=${"x".repeat(257)}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(oversizedRoom.status).toBe(400);
    expect(await oversizedRoom.text()).toBe("Invalid room");

    const oversizedPassword = await fetch(
      `${httpBase}/?room=valid&pwd=${"x".repeat(1025)}`,
      {
        headers: { Upgrade: "websocket" },
      },
    );
    expect(oversizedPassword.status).toBe(400);
    expect(await oversizedPassword.text()).toBe("Invalid password hash");
  });

  it("binds a socket to one client ID and rejects spoofed senders", async () => {
    const roomId = `identity-${Date.now()}`;
    const alice = await connect(roomId);
    const bob = await connect(roomId);
    expect(await alice.next()).toEqual({
      type: "connected",
      data: null,
    });
    expect(await bob.next()).toEqual({
      type: "connected",
      data: null,
    });

    await join(alice, client("alice"));
    await join(bob, client("bob"));
    expect(await bob.next()).toMatchObject({
      type: "join",
      data: { clientId: "alice" },
    });
    expect(await alice.next()).toMatchObject({
      type: "join",
      data: { clientId: "bob" },
    });

    alice.send({
      type: "message",
      data: {
        type: "offer",
        clientId: "mallory",
        targetClientId: "bob",
        data: "spoofed",
      },
    });
    expect(await alice.next()).toEqual({
      type: "error",
      data: "Invalid client signal",
    });

    alice.send({
      type: "leave",
      data: client("bob"),
    });
    expect(await bob.next()).toMatchObject({
      type: "leave",
      data: { clientId: "alice" },
    });
    expect((await alice.closed()).code).toBe(1000);
    expect(bob.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a socket that tries to change client ID", async () => {
    const inbox = await connect(`change-id-${Date.now()}`);
    await inbox.next();
    await join(inbox, client("charlie"));

    inbox.send({
      type: "join",
      data: client("delta"),
    });
    const closed = await inbox.closed();
    expect(closed.code).toBe(1008);
  });

  it("rejects binary and oversized signaling messages", async () => {
    const binary = await connect(`binary-${Date.now()}`);
    await binary.next();
    binary.socket.send(new Uint8Array([1, 2, 3]));
    expect((await binary.closed()).code).toBe(1003);

    const oversized = await connect(`oversized-${Date.now()}`);
    await oversized.next();
    oversized.socket.send(
      JSON.stringify({
        type: "pong",
        data: "x".repeat(1024 * 1024),
      }),
    );
    expect((await oversized.closed()).code).toBe(1009);
  });

  it("keeps only the latest 256 cached signals", async () => {
    const roomId = `cache-${Date.now()}`;
    const alice = await connect(roomId);
    const bob = await connect(roomId);
    await alice.next();
    await bob.next();
    await join(alice, client("alice-cache"));
    await join(bob, client("bob-cache"));
    await bob.next();
    await alice.next();

    bob.close();
    await bob.closed();
    await Bun.sleep(20);

    for (let sequence = 0; sequence < 300; sequence++) {
      alice.send({
        type: "message",
        data: {
          type: "candidate",
          clientId: "alice-cache",
          targetClientId: "bob-cache",
          data: sequence,
        },
      });
    }
    await Bun.sleep(50);

    const resumed = await connect(roomId);
    await resumed.next();
    const acknowledgement = await join(
      resumed,
      client("bob-cache", {
        resume: true,
        createdAt: Date.now() + 1,
      }),
    );
    expect(acknowledgement.data).toMatchObject({
      resumed: true,
    });

    const cached: number[] = [];
    for (let index = 0; index < 256; index++) {
      const signal = await resumed.next();
      cached.push(
        (
          signal.data as {
            data: number;
          }
        ).data,
      );
    }

    expect(cached).toHaveLength(256);
    expect(cached[0]).toBe(44);
    expect(cached.at(-1)).toBe(299);
  });
});
