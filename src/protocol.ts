import type { TransferClient } from "./types";

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
