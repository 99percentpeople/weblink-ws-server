import type Redis from "ioredis";

// Atomic room-wide admission across Redis workers. A live lease on another node
// is never displaced, including during failover; retry after its grace period.
export class DeviceLeases {
  constructor(
    private readonly redis: Redis,
    private readonly node: string,
    private readonly ttl: number,
  ) {}
  private key(room: string, client: string) {
    return `weblink:device:${JSON.stringify([room, client])}`;
  }
  async claim(
    room: string,
    client: string,
    connection: string,
    key?: string,
  ): Promise<boolean> {
    return (
      1 ===
      (await this.redis.eval(
        `
      local old = redis.call('GET', KEYS[1])
      if old then
        local v = cjson.decode(old)
        if v.node ~= ARGV[1] or (v.connection ~= ARGV[2] and (ARGV[3] == '' or v.key ~= ARGV[3])) then return 0 end
      end
      redis.call('SET', KEYS[1], cjson.encode({node=ARGV[1],connection=ARGV[2],key=ARGV[3]}), 'PX', ARGV[4])
      return 1
    `,
        1,
        this.key(room, client),
        this.node,
        connection,
        key ?? "",
        this.ttl,
      ))
    );
  }
  async refresh(
    room: string,
    client: string,
    connection: string,
  ): Promise<boolean> {
    return (
      1 ===
      (await this.redis.eval(
        `
      local old = redis.call('GET', KEYS[1])
      if not old or cjson.decode(old).connection ~= ARGV[1] then return 0 end
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 1
    `,
        1,
        this.key(room, client),
        connection,
        this.ttl,
      ))
    );
  }
  async release(
    room: string,
    client: string,
    connection: string,
  ): Promise<void> {
    await this.redis.eval(
      `
      local old = redis.call('GET', KEYS[1])
      if old and cjson.decode(old).connection == ARGV[1] then redis.call('DEL', KEYS[1]) end
      return 1
    `,
      1,
      this.key(room, client),
      connection,
    );
  }
}
