import { describe, expect, it } from "bun:test";
import {
  createJoinAcknowledgement,
  normalizeClientPresence,
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
