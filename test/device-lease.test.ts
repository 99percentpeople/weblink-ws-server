import { afterAll, expect, it } from "bun:test";
import Redis from "ioredis";
import { DeviceLeases } from "../src/device-lease";
// Optional external fixture; never use the application's configured Redis DB.
const url = process.env.WEBLINK_TEST_REDIS_URL;
const redis = url ? new Redis(url) : undefined;
afterAll(async () => {
  await redis?.quit();
});
(url ? it : it.skip)(
  "admits one cluster owner atomically, protects replacements from stale release, and expires abandoned leases",
  async () => {
    const room = crypto.randomUUID();
    const a = new DeviceLeases(redis!, "a", 500),
      b = new DeviceLeases(redis!, "b", 500);
    const results = await Promise.all([
      a.claim(room, "peer", "one", "key"),
      b.claim(room, "peer", "two", "attacker"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const owner = results[0] ? a : b,
      other = results[0] ? b : a,
      first = results[0] ? "one" : "two",
      key = results[0] ? "key" : "attacker";
    expect(await other.claim(room, "peer", "duplicate", key)).toBe(false);
    expect(await owner.claim(room, "peer", "unsigned")).toBe(false);
    expect(await owner.claim(room, "peer", "wrong-key", "wrong")).toBe(false);
    expect(await owner.claim(room, "peer", "replacement", key)).toBe(true);
    await owner.release(room, "peer", first);
    expect(await owner.refresh(room, "peer", first)).toBe(false);
    expect(await owner.refresh(room, "peer", "replacement")).toBe(true);
    expect(await other.claim(room, "peer", "still-blocked", key)).toBe(false);
    await Bun.sleep(550);
    expect(
      await other.claim(room, "peer", "after-expiry", "regenerated-key"),
    ).toBe(true);
    await other.release(room, "peer", "after-expiry");
  },
);

(url ? it : it.skip)(
  "moves unsigned leases across nodes and protects them after a signed upgrade",
  async () => {
    const room = crypto.randomUUID();
    const a = new DeviceLeases(redis!, "a", 5000);
    const b = new DeviceLeases(redis!, "b", 5000);
    expect(await a.claim(room, "legacy", "first")).toBe(true);
    expect(await a.claim(room, "legacy", "refresh")).toBe(true);
    expect(await b.claim(room, "legacy", "moved")).toBe(true);
    await a.release(room, "legacy", "refresh");
    expect(await a.refresh(room, "legacy", "refresh")).toBe(false);
    expect(await b.refresh(room, "legacy", "moved")).toBe(true);
    expect(await b.claim(room, "legacy", "upgraded", "verified-key")).toBe(
      true,
    );
    expect(await b.claim(room, "legacy", "downgrade")).toBe(false);
    expect(await a.claim(room, "legacy", "remote-downgrade")).toBe(false);
    expect(await a.claim(room, "legacy", "remote-signed", "verified-key")).toBe(
      false,
    );
    await b.release(room, "legacy", "moved");
    expect(await b.refresh(room, "legacy", "upgraded")).toBe(true);
    await b.release(room, "legacy", "upgraded");
  },
);
