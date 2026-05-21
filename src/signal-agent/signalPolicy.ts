import { db, signalAgentBlockedAccountsTable } from "../db/index.js";
import { eq } from "drizzle-orm";

export interface PolicyConfig {
  maxBatchSize: number;
  maxOwnerDaily: number;
  maxGlobalDaily: number;
  amountTinybars: number;
  requireHumanApproval: boolean;
  dryRunDefault: boolean;
  enabled: boolean;
  network: string;
  operatorAccountId: string;
}

/**
 * Loads policy configuration from environment variables.
 * All values have safe defaults — the agent is disabled and in dry-run mode
 * until explicitly enabled via SIGNAL_AGENT_ENABLED=true.
 */
export function loadPolicyConfig(): PolicyConfig {
  return {
    enabled: process.env.SIGNAL_AGENT_ENABLED === "true",
    network: process.env.SIGNAL_AGENT_NETWORK ?? "mainnet",
    operatorAccountId: process.env.SIGNAL_OPERATOR_ACCOUNT_ID ?? "",
    amountTinybars: parseInt(process.env.SIGNAL_AMOUNT_TINYBARS ?? "1", 10),
    requireHumanApproval: process.env.SIGNAL_REQUIRE_HUMAN_APPROVAL !== "false",
    dryRunDefault: process.env.SIGNAL_DRY_RUN_DEFAULT !== "false",
    maxBatchSize: parseInt(process.env.SIGNAL_MAX_BATCH_SIZE ?? "50", 10),
    maxOwnerDaily: parseInt(process.env.SIGNAL_MAX_OWNER_DAILY ?? "5", 10),
    maxGlobalDaily: parseInt(process.env.SIGNAL_MAX_GLOBAL_DAILY ?? "200", 10),
  };
}

export function hasWalletSecrets(): boolean {
  return !!(process.env.SIGNAL_OPERATOR_ACCOUNT_ID && process.env.SIGNAL_OPERATOR_PRIVATE_KEY);
}

export interface PolicyCheckResult {
  ok: boolean;
  errors: string[];
}

/**
 * Runs all policy gates before allowing a signal to be sent.
 * Checks: enabled flag, wallet secrets, human approval, owner change,
 * batch size cap, per-owner daily cap, global daily cap, memo validity,
 * and blocked account list.
 */
export async function checkSendPolicy(params: {
  recipientAccountId: string;
  memo: string;
  batchSendCount: number;
  ownerDailyCount: number;
  globalDailyCount: number;
  isApproved: boolean;
  ownerChangedSinceApproval: boolean;
}): Promise<PolicyCheckResult> {
  const config = loadPolicyConfig();
  const errors: string[] = [];

  if (!config.enabled) {
    errors.push("Signal Agent is disabled (SIGNAL_AGENT_ENABLED is not 'true')");
  }

  if (!hasWalletSecrets()) {
    errors.push(
      "Wallet credentials not configured — set SIGNAL_OPERATOR_ACCOUNT_ID and SIGNAL_OPERATOR_PRIVATE_KEY",
    );
  }

  if (config.requireHumanApproval && !params.isApproved) {
    errors.push("This group has not been approved by an admin");
  }

  if (params.ownerChangedSinceApproval) {
    errors.push("NFT owner changed since approval — re-resolve and re-approve before sending");
  }

  if (params.batchSendCount > config.maxBatchSize) {
    errors.push(`Batch size ${params.batchSendCount} exceeds cap of ${config.maxBatchSize}`);
  }

  if (params.ownerDailyCount >= config.maxOwnerDaily) {
    errors.push(
      `Owner ${params.recipientAccountId} has already received ${params.ownerDailyCount} signals today (cap: ${config.maxOwnerDaily})`,
    );
  }

  if (params.globalDailyCount >= config.maxGlobalDaily) {
    errors.push(`Global daily send limit of ${config.maxGlobalDaily} reached`);
  }

  const memoBytes = Buffer.byteLength(params.memo, "utf8");
  if (memoBytes > 100) {
    errors.push(`Memo too long: ${memoBytes} bytes (max 100)`);
  }

  if (!params.memo.startsWith("FrameTab signal:")) {
    errors.push("Memo must start with 'FrameTab signal:'");
  }

  const blocked = await db
    .select()
    .from(signalAgentBlockedAccountsTable)
    .where(eq(signalAgentBlockedAccountsTable.accountId, params.recipientAccountId))
    .limit(1);

  if (blocked.length > 0) {
    errors.push(`Recipient account ${params.recipientAccountId} is on the blocked list`);
  }

  return { ok: errors.length === 0, errors };
}
