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
