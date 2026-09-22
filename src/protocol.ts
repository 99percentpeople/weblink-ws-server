import type { ClientSignal, RawSignal, TransferClient } from "./types";

export const SIGNALING_PROTOCOL_VERSION = 2;
export const MAX_CLIENT_ID_LENGTH = 128;
export const MAX_ROOM_ID_LENGTH = 256;
export const MAX_PASSWORD_HASH_LENGTH = 1024;
export const MAX_SIGNAL_MESSAGE_BYTES = 1024 * 1024;
export const MAX_CACHED_SIGNALS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clientId = value.trim();
  if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH) {
    return null;
  }
  return clientId;
}

export function parseTransferClient(value: unknown): TransferClient | null {
  if (!isRecord(value)) return null;

  const clientId = normalizeClientId(value["clientId"]);
  if (
    !clientId ||
    typeof value["createdAt"] !== "number" ||
    !Number.isFinite(value["createdAt"])
  ) {
    return null;
  }

  const rtcProfileVersion =
    typeof value["rtcProfileVersion"] === "number" &&
    Number.isFinite(value["rtcProfileVersion"])
      ? value["rtcProfileVersion"]
      : undefined;

  return {
    clientId,
    createdAt: value["createdAt"],
    rtcProfileVersion,
    resume: value["resume"] === true ? true : undefined,
  };
}

export function parseClientSignal(value: unknown): ClientSignal | null {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return null;
  }

  const clientId = normalizeClientId(value["clientId"]);
  const targetClientId = normalizeClientId(value["targetClientId"]);
  if (!clientId || !targetClientId) return null;

  return {
    type: value["type"],
    data: value["data"],
    clientId,
    targetClientId,
    sessionId:
      typeof value["sessionId"] === "string" ? value["sessionId"] : undefined,
  };
}

export function parseRawSignal(message: string): RawSignal {
  const value: unknown = JSON.parse(message);
  if (!isRecord(value) || typeof value["type"] !== "string") {
    throw new Error("invalid signal envelope");
  }

  return {
    type: value["type"],
    data: value["data"],
  };
}

export function encodedMessageSize(message: string): number {
  return new TextEncoder().encode(message).byteLength;
}

export function createJoinAcknowledgement(resumed: boolean): RawSignal {
  return {
    type: "joined",
    data: {
      protocolVersion: SIGNALING_PROTOCOL_VERSION,
      resumed,
    },
  };
}

export function normalizeClientPresence(
  client: TransferClient,
): TransferClient {
  return {
    clientId: client.clientId,
    createdAt: client.createdAt,
    rtcProfileVersion:
      typeof client.rtcProfileVersion === "number"
        ? client.rtcProfileVersion
        : undefined,
    resume: client.resume === true ? true : undefined,
  };
}
