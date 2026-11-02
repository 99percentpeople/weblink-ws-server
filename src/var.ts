export const LOG_LEVEL = process.env["LOG_LEVEL"] || "info";
export const HOSTNAME = process.env["HOSTNAME"] || "0.0.0.0";
export const PORT = parseInt(process.env["PORT"] || "9000", 10);
export const HEARTBEAT_INTERVAL = parseInt(
  process.env["HEARTBEAT_INTERVAL"] || "30000",
  10,
);
export const PONG_TIMEOUT = parseInt(
  process.env["PONG_TIMEOUT"] || "60000",
  10,
);
export const DISCONNECT_TIMEOUT = parseInt(
  process.env["DISCONNECT_TIMEOUT"] || "90000",
  10,
);
export const REDIS_URL = process.env["REDIS_URL"] || null;
export const TLS_CERT_FILE = process.env["TLS_CERT_FILE"] || null;
export const TLS_KEY_FILE = process.env["TLS_KEY_FILE"] || null;
// comma separated list of CA files
export const TLS_CA_FILES = process.env["TLS_CA_FILES"]?.split(",") || null;
export const TLS_ENABLED = TLS_CERT_FILE !== null && TLS_KEY_FILE !== null;

// Admission guards for a public signaling service. Proxy IP forwarding is opt-in.
function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
export const MAX_WS_HANDSHAKES_PER_IP_PER_MINUTE = positiveInteger(
  "MAX_WS_HANDSHAKES_PER_IP_PER_MINUTE",
  60,
);
export const MAX_WS_CONNECTIONS_PER_IP = positiveInteger(
  "MAX_WS_CONNECTIONS_PER_IP",
  64,
);
export const MAX_ACTIVE_ROOMS = positiveInteger("MAX_ACTIVE_ROOMS", 10_000);
export const MAX_CLIENTS_PER_ROOM = positiveInteger(
  "MAX_CLIENTS_PER_ROOM",
  128,
);
export const WS_JOIN_TIMEOUT_MS = positiveInteger("WS_JOIN_TIMEOUT_MS", 15_000);
// Only trust X-Real-IP when the immediate TCP peer is one of these proxies.
// Trusted proxies MUST overwrite this header, never forward arbitrary client values.
export const TRUSTED_PROXY_IPS = new Set(
  (process.env["TRUSTED_PROXY_IPS"] ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
);
