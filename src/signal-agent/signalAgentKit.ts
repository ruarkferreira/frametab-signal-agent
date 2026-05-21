/**
 * SignalAgentKit — Hedera Agent Kit integration layer.
 *
 * The Signal Agent uses @hashgraph/hedera-agent-kit to execute HBAR transfers.
 * This file defines the signal-specific tool interface and exposes the Kit's
 * transfer_hbar_tool as the on-chain action executor.
 *
 * Hedera Agent Kit: https://github.com/hedera-dev/hedera-agent-kit
 * npm: https://www.npmjs.com/package/@hashgraph/hedera-agent-kit
 */

import { AgentMode, type Context } from "@hashgraph/hedera-agent-kit";
import * as KitPlugins from "@hashgraph/hedera-agent-kit/plugins";

export interface SignalAgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  kitTool?: string;
}

/**
 * The four tools that make up the Signal Agent pipeline.
 * Tools backed by the Hedera Agent Kit are tagged with kitTool.
 */
export const SIGNAL_AGENT_TOOLS: SignalAgentTool[] = [
  {
    name: "resolve_nft_owner",
    description:
      "Resolves the current Hedera account that owns a given NFT (tokenId + serial) " +
      "by querying the Hedera Mirror Node REST API.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: { type: "string", description: "Hedera token ID (e.g. 0.0.878200)" },
        serial: { type: "number", description: "NFT serial number" },
      },
      required: ["tokenId", "serial"],
    },
  },
  {
    name: "send_signal_tinybar",
    description:
      "Sends a 1-tinybar HBAR signal from the operator wallet to the current NFT owner " +
      "with a public memo encoding engagement data " +
      "(e.g. 'FrameTab signal: 3F 12W 0.0.878200#42'). " +
      "Backed by the Hedera Agent Kit transfer_hbar_tool. Requires prior admin approval.",
    inputSchema: {
      type: "object",
      properties: {
        recipientAccountId: { type: "string" },
        amountTinybars: { type: "number", default: 1 },
        memo: { type: "string", maxLength: 100 },
        isDryRun: { type: "boolean", default: false },
      },
      required: ["recipientAccountId", "memo"],
    },
    kitTool: KitPlugins.TRANSFER_HBAR_TOOL,
  },
  {
    name: "build_daily_signal_queue",
    description:
      "Groups favorite and watchlist additions by NFT for a given date window, " +
      "derives signal counts, and upserts grouped rows into signal_agent_groups " +
      "for admin review.",
    inputSchema: {
      type: "object",
      properties: {
        windowDate: { type: "string", format: "date", description: "YYYY-MM-DD" },
      },
      required: ["windowDate"],
    },
  },
  {
    name: "get_wallet_balance",
    description:
      "Returns the current HBAR balance (in tinybars) of the signal operator wallet " +
      "via the Hedera Mirror Node.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
      },
      required: ["accountId"],
    },
    kitTool: KitPlugins.GET_HBAR_BALANCE_QUERY_TOOL,
  },
];

/** Returns the Kit's transfer_hbar_tool instance for the given context. */
export function getKitTransferTool(context: Context = { mode: AgentMode.AUTONOMOUS }) {
  return KitPlugins.transferHbarTool(context);
}

/**
 * Returns all tool method names available in @hashgraph/hedera-agent-kit/plugins.
 * Uses the exported tool-name constants for reliable runtime discovery
 * without requiring a connected Client.
 */
export function listKitTools(): string[] {
  return Object.entries(KitPlugins)
    .filter(
      ([key, value]) =>
        key === key.toUpperCase() &&
        key.endsWith("_TOOL") &&
        typeof value === "string",
    )
    .map(([, value]) => value as string);
}

export function describeAgentKit(): string {
  const kitTool = getKitTransferTool();
  return [
    "Signal Agent uses @hashgraph/hedera-agent-kit for on-chain HBAR transfers.",
    `Kit tool used for send: ${kitTool.method} — ${kitTool.description}`,
    "",
    "Signal-specific tools:",
    ...SIGNAL_AGENT_TOOLS.map(
      (t) =>
        `  • ${t.name}${t.kitTool ? ` [via Kit: ${t.kitTool}]` : ""}: ${t.description}`,
    ),
  ].join("\n");
}
