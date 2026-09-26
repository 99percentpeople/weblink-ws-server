import { describe, expect, it, mock, spyOn } from "bun:test";
const vi = { fn: mock, spyOn };
import {
  handleTurnCredentials,
  TURN_CREDENTIAL_TTL_SECONDS,
} from "../src/turn-credentials";

const settings = {
  TURN_KEY_ID: "test-key",
  TURN_KEY_API_TOKEN: "test-token",
};
const endpoint = "https://ws.webl.ink/turn-credentials";
const iceServers = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ],
    username: "temporary-user",
    credential: "temporary-password",
  },
];
function request(method = "POST") {
  return new Request(endpoint, {
    method,
    headers: { Origin: "https://webl.ink" },
  });
}
function upstream(data: unknown, status = 201): typeof fetch {
  return (async () => Response.json(data, { status })) as typeof fetch;
}
function expectHeaders(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("TURN credentials HTTP contract", () => {
  it("supports preflight without configuration or upstream traffic", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleTurnCredentials(
      request("OPTIONS"),
      {},
      fetcher,
    );
    expect(response.status).toBe(204);
    expectHeaders(response);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects other methods before contacting the provider", async () => {
    const response = await handleTurnCredentials(request("GET"), settings);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expectHeaders(response);
  });

  it("reports an unconfigured backend without echoing configuration", async () => {
    for (const env of [
      {},
      { TURN_KEY_ID: "test-key" },
      { TURN_KEY_API_TOKEN: "test-token" },
    ]) {
      const response = await handleTurnCredentials(request(), env);
      expect(response.status).toBe(503);
      expectHeaders(response);
      expect(await response.json()).toEqual({
        error: "TURN is not configured",
      });
    }
  });

  it("exchanges server configuration for expiring WebRTC credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      upstream({
        iceServers: [
          iceServers[0],
          { ...iceServers[1], privateField: "not-public" },
        ],
        privateField: "not-public",
      }),
    );
    const before = Date.now();
    const response = await handleTurnCredentials(
      new Request(endpoint, {
        method: "POST",
        body: JSON.stringify({ ttl: 99999999 }),
      }),
      settings,
      fetcher,
    );
    expect(response.status).toBe(200);
    expectHeaders(response);
    const body = (await response.json()) as {
      iceServers: unknown;
      expiresAt: number;
    };
    expect(body.iceServers).toEqual(iceServers);
    expect(body.expiresAt).toBeGreaterThanOrEqual(
      before + TURN_CREDENTIAL_TTL_SECONDS * 1000,
    );
    expect(body.expiresAt).toBeLessThanOrEqual(
      Date.now() + TURN_CREDENTIAL_TTL_SECONDS * 1000,
    );
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "iceServers"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ ttl: 86400 });
    expect(init?.signal).toBeDefined();
    expect(init?.redirect).toBe("error");
  });

  it("normalizes singular URL strings", async () => {
    const response = await handleTurnCredentials(
      request(),
      settings,
      upstream({
        iceServers: [
          { urls: "turn:example:3478", username: "u", credential: "p" },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { iceServers: unknown };
    expect(data.iceServers).toEqual([
      { urls: ["turn:example:3478"], username: "u", credential: "p" },
    ]);
  });

  it("hides upstream failure bodies and network exceptions", async () => {
    for (const status of [401, 429, 500]) {
      const response = await handleTurnCredentials(
        request(),
        settings,
        upstream({ secret: "do-not-return" }, status),
      );
      expect(response.status).toBe(502);
      expectHeaders(response);
      expect(await response.json()).toEqual({
        error: "TURN credential service unavailable",
      });
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private-provider-details"));
    const response = await handleTurnCredentials(request(), settings, fetcher);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private-provider-details");
  });

  it("rejects invalid provider responses instead of breaking RTCPeerConnection", async () => {
    const invalid = [
      null,
      {},
      { iceServers: {} },
      { iceServers: [] },
      { iceServers: [null] },
      { iceServers: [{ urls: [] }] },
      { iceServers: [{ urls: ["https://example.com"] }] },
      { iceServers: [{ urls: ["turn:example"], username: "u" }] },
      { iceServers: [iceServers[0]] },
    ];
    for (const data of invalid) {
      const response = await handleTurnCredentials(
        request(),
        settings,
        upstream(data),
      );
      expect(response.status).toBe(502);
      expectHeaders(response);
    }
    const fetcher = (async () => new Response("not-json")) as typeof fetch;
    expect(
      (await handleTurnCredentials(request(), settings, fetcher)).status,
    ).toBe(502);
  });

  it("returns a bounded timeout response", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(
        AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
      );
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
      const response = await handleTurnCredentials(
        request(),
        settings,
        fetcher,
      );
      expect(response.status).toBe(504);
      expectHeaders(response);
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
