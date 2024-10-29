export const LOG_LEVEL = process.env["LOG_LEVEL"] || "info";
export const HOSTNAME = process.env["HOSTNAME"] || "0.0.0.0";
export const PORT = parseInt(process.env["PORT"] || "9000", 10);
export const HEARTBEAT_INTERVAL = parseInt(process.env["HEARTBEAT_INTERVAL"] || "30000", 10);
export const PONG_TIMEOUT = parseInt(process.env["PONG_TIMEOUT"] || "60000", 10);
export const DISCONNECT_TIMEOUT = parseInt(process.env["DISCONNECT_TIMEOUT"] || "90000", 10);
export const REDIS_URL = process.env["REDIS_URL"] || null;
export const TLS_CERT_FILE = process.env["TLS_CERT_FILE"] || null;
export const TLS_KEY_FILE = process.env["TLS_KEY_FILE"] || null;
// comma separated list of CA files
export const TLS_CA_FILES = process.env["TLS_CA_FILES"]?.split(",") || null;
export const TLS_ENABLED = TLS_CERT_FILE !== null && TLS_KEY_FILE !== null;
