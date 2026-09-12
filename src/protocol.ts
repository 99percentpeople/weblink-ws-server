import type { RawSignal, TransferClient } from "./types";

export const SIGNALING_PROTOCOL_VERSION = 2;

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
