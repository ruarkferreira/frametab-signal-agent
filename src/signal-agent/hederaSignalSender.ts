import {
  Client,
  AccountId,
  PrivateKey,
} from "@hiero-ledger/sdk";
import {
  HederaAgentAPI,
  HederaBuilder,
  HederaParameterNormaliser,
  handleTransaction,
  AgentMode,
  type Context,
  type RawTransactionResponse,
} from "@hashgraph/hedera-agent-kit";
import { db, signalAgentTransactionsTable, signalAgentEventsTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { loadPolicyConfig } from "./signalPolicy.js";

export interface SendSignalParams {
  groupId: number;
  tokenId: string;
  serial: number;
  recipientAccountId: string;
  memo: string;
  isDryRun?: boolean;
  initiatedBy?: string;
}

export interface SendSignalResult {
  ok: boolean;
  txId?: string;
  hashscanUrl?: string;
  error?: string;
  isDryRun: boolean;
  transactionLogId?: number;
}

function buildHashscanUrl(txId: string, network: string): string {
  const networkPath = network === "testnet" ? "testnet" : "";
  const base = networkPath
    ? `https://hashscan.io/${networkPath}/transaction`
    : "https://hashscan.io/mainnet/transaction";
  return `${base}/${txId}`;
}

/**
 * Initialises the Hedera Agent Kit with operator credentials.
 *
 * Uses @hiero-ledger/sdk (Hedera's rebranded SDK, same API as @hashgraph/sdk)
 * as required by @hashgraph/hedera-agent-kit v4's peer dependency.
 *
 * The operator wallet must use an ECDSA secp256k1 key (most Hedera wallets
 * created via HashPack, Blade, or the developer portal use this key type).
 */
function buildHederaAgentKit(): {
  agentKit: HederaAgentAPI;
  client: Client;
  context: Context;
} {
  const accountId = process.env.SIGNAL_OPERATOR_ACCOUNT_ID;
  const privateKey = process.env.SIGNAL_OPERATOR_PRIVATE_KEY;
  const network = process.env.SIGNAL_AGENT_NETWORK ?? "mainnet";

  if (!accountId || !privateKey) {
    throw new Error(
      "SIGNAL_OPERATOR_ACCOUNT_ID and SIGNAL_OPERATOR_PRIVATE_KEY must be set",
    );
  }

  const client = network === "testnet" ? Client.forTestnet() : Client.forMainnet();
  client.setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));

  const context: Context = {
    accountId,
    mode: AgentMode.AUTONOMOUS,
  };

  const agentKit = new HederaAgentAPI(client, context);

  return { agentKit, client, context };
}

/**
 * Sends a signal transaction to the NFT owner.
 *
 * Pipeline (using @hashgraph/hedera-agent-kit):
 *   1. HederaParameterNormaliser.normaliseTransferHbar() — validates + resolves params
 *   2. HederaBuilder.transferHbar() — builds the TransferTransaction
 *   3. handleTransaction() — signs, submits, and awaits receipt
 *
 * Dry-run mode skips on-chain execution and logs the intent only.
 * All sends are gated by the policy engine (signalPolicy.ts).
 */
export async function sendSignalTransaction(params: SendSignalParams): Promise<SendSignalResult> {
  const config = loadPolicyConfig();
  const isDryRun = params.isDryRun ?? config.dryRunDefault;
  const network = config.network;
  const senderAccountId = config.operatorAccountId;

  const [txLogRow] = await db
    .insert(signalAgentTransactionsTable)
    .values({
      groupId: params.groupId,
      tokenId: params.tokenId,
      serial: params.serial,
      recipientAccountId: params.recipientAccountId,
      senderAccountId,
      amountTinybars: config.amountTinybars,
      memo: params.memo,
      status: "pending",
      isDryRun,
      initiatedBy: params.initiatedBy ?? "system",
    })
    .returning();

  const logId = txLogRow.id;

  if (isDryRun) {
    await db
      .update(signalAgentTransactionsTable)
      .set({ status: "dry_run_ok", completedAt: new Date() })
      .where(eq(signalAgentTransactionsTable.id, logId));

    await db.insert(signalAgentEventsTable).values({
      tokenId: params.tokenId,
      serial: params.serial,
      action: "dry_run_sent",
      source: params.initiatedBy ?? "system",
      meta: { groupId: params.groupId, logId, memo: params.memo },
    });

    return { ok: true, isDryRun: true, transactionLogId: logId };
  }

  let client: Client | undefined;

  try {
    const kit = buildHederaAgentKit();
    client = kit.client;
    const { context } = kit;

    // Amount in whole HBAR (Agent Kit expects HBAR, not tinybars)
    const rawParams = {
      transfers: [
        {
          accountId: params.recipientAccountId,
          amount: config.amountTinybars * 1e-8,
        },
      ],
      sourceAccountId: senderAccountId,
      transactionMemo: params.memo,
    };

    const normalised = await HederaParameterNormaliser.normaliseTransferHbar(
      rawParams,
      context,
      client,
    );

    const tx = HederaBuilder.transferHbar(normalised);

    const result = await handleTransaction(tx, client, context);

    if ("bytes" in result) {
      throw new Error("Unexpected RETURN_BYTES response — agent mode should be AUTONOMOUS");
    }

    const raw = result.raw as RawTransactionResponse;

    if (raw.status !== "SUCCESS") {
      throw new Error(`Transaction status: ${raw.status}`);
    }

    const txId = raw.transactionId;
    const hashscanUrl = buildHashscanUrl(txId, network);

    await db
      .update(signalAgentTransactionsTable)
      .set({ status: "success", txId, hashscanUrl, completedAt: new Date() })
      .where(eq(signalAgentTransactionsTable.id, logId));

    await db.insert(signalAgentEventsTable).values({
      tokenId: params.tokenId,
      serial: params.serial,
      action: "signal_sent",
      source: params.initiatedBy ?? "system",
      meta: { groupId: params.groupId, logId, txId, memo: params.memo },
    });

    client.close();
    return { ok: true, txId, hashscanUrl, isDryRun: false, transactionLogId: logId };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);

    client?.close();

    await db
      .update(signalAgentTransactionsTable)
      .set({ status: "failed", error, completedAt: new Date() })
      .where(eq(signalAgentTransactionsTable.id, logId));

    await db.insert(signalAgentEventsTable).values({
      tokenId: params.tokenId,
      serial: params.serial,
      action: "send_failed",
      source: params.initiatedBy ?? "system",
      meta: { groupId: params.groupId, logId, error },
    });

    return { ok: false, error, isDryRun: false, transactionLogId: logId };
  }
}
