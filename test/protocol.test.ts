import { describe, expect, it } from "bun:test";
import { normalizeClientPresence } from "../src/protocol";
import type { TransferClient } from "../src/types";

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
