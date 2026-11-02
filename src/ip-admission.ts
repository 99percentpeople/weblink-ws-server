/** In-process admission guard. Use an edge limiter too for multi-node deployments. */
export class IpAdmissionLimiter {
  private readonly entries = new Map<
    string,
    { windowStart: number; attempts: number; active: number }
  >();

  constructor(
    private readonly maxAttempts: number,
    private readonly maxActive: number,
    private readonly windowMs = 60_000,
    private readonly maxTrackedIps = 10_000,
  ) {}

  admit(ip: string, now = Date.now()): boolean {
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= this.maxTrackedIps) this.prune(now);
      if (this.entries.size >= this.maxTrackedIps) return false;
      entry = { windowStart: now, attempts: 0, active: 0 };
      this.entries.set(ip, entry);
    } else if (now - entry.windowStart >= this.windowMs) {
      entry.windowStart = now;
      entry.attempts = 0;
    }

    if (entry.attempts >= this.maxAttempts || entry.active >= this.maxActive) {
      return false;
    }
    entry.attempts++;
    entry.active++;
    return true;
  }

  release(ip: string, now = Date.now()): void {
    const entry = this.entries.get(ip);
    if (!entry) return;
    entry.active = Math.max(0, entry.active - 1);
    if (entry.active === 0 && now - entry.windowStart >= this.windowMs) {
      this.entries.delete(ip);
    }
  }

  prune(now = Date.now()): void {
    for (const [ip, entry] of this.entries) {
      if (entry.active === 0 && now - entry.windowStart >= this.windowMs) {
        this.entries.delete(ip);
      }
    }
  }
}
