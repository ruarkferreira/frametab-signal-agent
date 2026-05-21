export interface SignalMemoParams {
  tokenId: string;
  serial: number;
  favoriteCount: number;
  watchCount: number;
}

/**
 * Builds the on-chain memo string encoding engagement data.
 * Format: "FrameTab signal: {F}F {W}W {tokenId}#{serial}"
 * Example: "FrameTab signal: 3F 12W 0.0.878200#42"
 *
 * The memo is written to the Hedera transaction and is permanently
 * visible on HashScan and any mirror node query.
 */
export function buildMemo(params: SignalMemoParams): string {
  const { tokenId, serial, favoriteCount, watchCount } = params;
  return `FrameTab signal: ${favoriteCount}F ${watchCount}W ${tokenId}#${serial}`;
}

export interface MemoValidationResult {
  ok: boolean;
  memo: string;
  byteLength: number;
  errors: string[];
}

export function validateMemo(memo: string): MemoValidationResult {
  const errors: string[] = [];
  const byteLength = Buffer.byteLength(memo, "utf8");

  if (!memo.startsWith("FrameTab signal:")) {
    errors.push("Memo must start with 'FrameTab signal:'");
  }
  if (byteLength > 100) {
    errors.push(`Memo is ${byteLength} bytes; max allowed is 100`);
  }

  return { ok: errors.length === 0, memo, byteLength, errors };
}

export function buildAndValidateMemo(params: SignalMemoParams): MemoValidationResult {
  const memo = buildMemo(params);
  return validateMemo(memo);
}
