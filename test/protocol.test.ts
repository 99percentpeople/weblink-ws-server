import { describe, expect, it } from "bun:test";
import {
  MAX_CACHED_SIGNALS,
  MAX_CLIENT_ID_LENGTH,
  MAX_PASSWORD_HASH_LENGTH,
  MAX_ROOM_ID_LENGTH,
  MAX_SIGNAL_MESSAGE_BYTES,
  createJoinAcknowledgement,
  encodedMessageSize,
  normalizeClientPresence,
  parseClientSignal,
  parseRawSignal,
  parseTransferClient,
} from "../src/protocol";
import type { TransferClient } from "../src/types";

describe("signaling protocol", () => {
  it("creates a versioned join acknowledgement", () => {
    expect(createJoinAcknowledgement(true)).toEqual({
      type: "joined",
      data: {
        protocolVersion: 2,
        resumed: true,
      },
    });
  });

  it("keeps the same input limits as the Worker", () => {
    expect(MAX_CLIENT_ID_LENGTH).toBe(128);
    expect(MAX_ROOM_ID_LENGTH).toBe(256);
    expect(MAX_PASSWORD_HASH_LENGTH).toBe(1024);
    expect(MAX_SIGNAL_MESSAGE_BYTES).toBe(1024 * 1024);
    expect(MAX_CACHED_SIGNALS).toBe(256);
  });

  it("parses and normalizes client presence", () => {
    expect(
      parseTransferClient({
        clientId: "  alice  ",
        createdAt: 42,
        rtcProfileVersion: 1,
        resume: true,
        name: "Private Alice",
      }),
    ).toEqual({
      clientId: "alice",
      createdAt: 42,
      rtcProfileVersion: 1,
      resume: true,
    });

    expect(
      parseTransferClient({
        clientId: "x".repeat(MAX_CLIENT_ID_LENGTH + 1),
        createdAt: 42,
      }),
    ).toBeNull();

    expect(
      parseTransferClient({
        clientId: "alice",
        createdAt: Number.NaN,
      }),
    ).toBeNull();
  });

  it("parses client signals and signal envelopes", () => {
    expect(
      parseClientSignal({
        type: "offer",
        clientId: "alice",
        targetClientId: "bob",
        data: "encrypted-offer",
      }),
    ).toEqual({
      type: "offer",
      clientId: "alice",
      targetClientId: "bob",
      data: "encrypted-offer",
      sessionId: undefined,
    });

    expect(
      parseClientSignal({
        type: "offer",
        clientId: "",
        targetClientId: "bob",
      }),
    ).toBeNull();

    expect(
      parseRawSignal(
        JSON.stringify({
          type: "pong",
          ignored: true,
        }),
      ),
    ).toEqual({
      type: "pong",
      data: undefined,
    });

    expect(() => parseRawSignal(JSON.stringify({ data: 1 }))).toThrow();
  });

  it("measures encoded message size in bytes", () => {
    expect(encodedMessageSize("abc")).toBe(3);
    expect(encodedMessageSize("你")).toBe(3);
  });
});

describe("normalizeClientPresence", () => {
  it("keeps only room and connection metadata", () => {
    const legacyPresence = {
      clientId: "alice",
      name: "Private Alice",
      avatar: "data:image/png;base64,private",
      createdAt: 42,
      rtcProfileVersion: 1,
      resume: true,
    } as unknown as TransferClient;

    const presence = normalizeClientPresence(legacyPresence);

    expect(presence).toEqual({
      clientId: "alice",
      createdAt: 42,
      rtcProfileVersion: 1,
      resume: true,
    });
    expect(presence).not.toHaveProperty("name");
    expect(presence).not.toHaveProperty("avatar");
  });
});
