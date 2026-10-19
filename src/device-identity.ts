/** Optional proof for safe same-ID reconnection. Never trust caller-supplied resume flags. */
export async function verifyJoinIdentity(
  challenge: string,
  clientId: string,
  createdAt: number,
  proof: unknown,
): Promise<string | undefined> {
  try {
    if (!proof || typeof proof !== "object") return;
    const { publicKey, signature } = proof as Record<string, unknown>;
    if (
      typeof publicKey !== "string" ||
      publicKey.length !== 88 ||
      typeof signature !== "string" ||
      signature.length !== 88
    )
      return;
    const bytes = (v: string) =>
      Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const transcript = new TextEncoder().encode(
      JSON.stringify([
        "weblink-signaling-identity/1",
        challenge,
        clientId,
        createdAt,
      ]),
    );
    if (
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        bytes(signature),
        transcript,
      )
    )
      return publicKey;
  } catch {
    /* Invalid proofs cannot replace an existing owner. */
  }
}
export function mayReplace(
  existingKey: string | undefined,
  candidateKey: string | undefined,
): boolean {
  return !!existingKey && existingKey === candidateKey;
}
