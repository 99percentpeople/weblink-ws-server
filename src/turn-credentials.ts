export interface TurnCredentialsEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

export const TURN_CREDENTIAL_TTL_SECONDS = 86_400;
const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "cache-control": "no-store",
};

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

function parseIceServers(data: unknown): IceServer[] {
  if (!data || typeof data !== "object" || !("iceServers" in data)) {
    throw new Error("Invalid ICE response");
  }
  if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
    throw new Error("Invalid ICE servers");
  }
  let hasTurn = false;
  const servers = data.iceServers.map((server: unknown): IceServer => {
    if (!server || typeof server !== "object" || !("urls" in server)) {
      throw new Error("Invalid ICE server");
    }
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (
      !Array.isArray(urls) ||
      !urls.length ||
      !urls.every(
        (url: unknown) =>
          typeof url === "string" && /^(stun|turn)s?:\S+$/.test(url),
      )
    )
      throw new Error("Invalid ICE URLs");
    if (urls.some((url: string) => /^turns?:/.test(url))) {
      if (
        !("username" in server) ||
        typeof server.username !== "string" ||
        !server.username ||
        !("credential" in server) ||
        typeof server.credential !== "string" ||
        !server.credential
      ) {
        throw new Error("Invalid TURN credentials");
      }
      hasTurn = true;
      return { urls, username: server.username, credential: server.credential };
    }
    return { urls };
  });
  if (!hasTurn) throw new Error("Missing TURN server");
  return servers;
}

export async function handleTurnCredentials(
  request: Request,
  env: TurnCredentialsEnv,
  fetchUpstream: typeof fetch = fetch,
): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { ...HEADERS, allow: "POST, OPTIONS" },
      },
    );
  }
  const keyId = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!keyId || !token) {
    return Response.json(
      { error: "TURN is not configured" },
      { status: 503, headers: HEADERS },
    );
  }
  // Count upstream latency against the lifetime, not in addition to it.
  const expiresAt = Date.now() + TURN_CREDENTIAL_TTL_SECONDS * 1000;
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetchUpstream(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
        redirect: "error",
        signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return Response.json(
        { error: "TURN credential service unavailable" },
        { status: 502, headers: HEADERS },
      );
    }
    const iceServers = parseIceServers(await response.json());
    return Response.json({ iceServers, expiresAt }, { headers: HEADERS });
  } catch {
    return Response.json(
      { error: "TURN credential service unavailable" },
      {
        status: signal.aborted ? 504 : 502,
        headers: HEADERS,
      },
    );
  }
}
