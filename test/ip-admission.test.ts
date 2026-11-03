import { describe, expect, it } from "bun:test";
import { IpAdmissionLimiter } from "../src/ip-admission";

describe("per-IP WebSocket admission", () => {
  it("enforces a rolling window and releases concurrent slots", () => {
    const limiter = new IpAdmissionLimiter(2, 1, 60_000);
    expect(limiter.admit("ip-a", 1)).toBe(true);
    expect(limiter.admit("ip-a", 2)).toBe(false);
    expect(limiter.admit("ip-b", 2)).toBe(true);
    limiter.release("ip-a", 3);
    expect(limiter.admit("ip-a", 4)).toBe(true);
    limiter.release("ip-a", 5);
    expect(limiter.admit("ip-a", 6)).toBe(false);
    expect(limiter.admit("ip-a", 60_001)).toBe(true);
  });

  it("bounds the number of tracked addresses and discards expired idle buckets", () => {
    const limiter = new IpAdmissionLimiter(1, 1, 100, 2);
    expect(limiter.admit("a", 0)).toBe(true);
    expect(limiter.admit("b", 0)).toBe(true);
    expect(limiter.admit("c", 1)).toBe(false);
    limiter.release("a", 2);
    expect(limiter.admit("c", 101)).toBe(true);
  });
});
