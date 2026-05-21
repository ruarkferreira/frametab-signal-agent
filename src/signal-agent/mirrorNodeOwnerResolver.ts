const MIRROR_BASE =
  process.env.HEDERA_MIRROR_BASE_URL ?? "https://mainnet.mirrornode.hedera.com/api/v1";

export interface NftOwnerResult {
  accountId: string;
  resolvedAt: Date;
}

/**
 * Resolves the current Hedera account ID that owns a given NFT
 * by querying the Hedera Mirror Node REST API.
 *
 * Returns null if the token/serial doesn't exist or the API is unavailable.
 */
export async function resolveNftOwner(
  tokenId: string,
  serial: number,
): Promise<NftOwnerResult | null> {
  try {
    const url = `${MIRROR_BASE}/tokens/${tokenId}/nfts/${serial}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { account_id?: string };
    if (!data.account_id) return null;
    return { accountId: data.account_id, resolvedAt: new Date() };
  } catch {
    return null;
  }
}

/**
 * Returns the current HBAR balance (in tinybars) for a given account.
 * Uses the Hedera Mirror Node REST API — no private key required.
 */
export async function getWalletBalance(accountId: string): Promise<number | null> {
  try {
    const url = `${MIRROR_BASE}/accounts/${accountId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: { balance?: number } };
    return data.balance?.balance ?? null;
  } catch {
    return null;
  }
}
