# Hedera Agent AI Bounty — Week 1 Submission

**Project:** FrameTab Signal Agent  
**Team:** FrameTab (ruark-xyz)  
**Live demo:** https://app.frametab.gallery  
**Repository:** https://github.com/ruark-xyz/frametab-signal-agent  
**Submitted:** May 2026

---

## Use Case

**Problem:** NFT collectors actively discover, favorite, and watchlist NFTs on platforms like FrameTab — but the NFT owners have no way to know their pieces are generating real collector interest. There's no on-chain signal to bridge collector engagement with creator/owner awareness.

**Solution:** The FrameTab Signal Agent creates an automated, agentic pipeline that:

1. Detects daily engagement spikes (favorites + watchlist additions per NFT)
2. Resolves the current on-chain NFT owner via the Hedera Mirror Node
3. Sends a 1-tinybar HBAR transaction to the owner with a structured public memo encoding the engagement data
4. Logs everything — admin can review, approve, and audit every signal before it goes on-chain

The result is a **permanent, publicly auditable proof of collector engagement** written to Hedera mainnet. Every signal transaction is visible on [HashScan](https://hashscan.io) to anyone.

**Memo format:**
```
FrameTab signal: 3F 12W 0.0.878200#42
```
- `3F` = 3 new favorites that day  
- `12W` = 12 watchlist additions  
- `0.0.878200#42` = token ID + serial number of the NFT

---

## Hedera Agent Kit Integration

The Signal Agent uses **`@hashgraph/hedera-agent-kit` v4.0.0** as the core execution layer for on-chain actions.

### Package Installation
```json
"@hashgraph/hedera-agent-kit": "^4.0.0",
"@hiero-ledger/sdk": "^2.84.0"
```

*Note: `@hiero-ledger/sdk` is the Hedera-rebranded SDK (same API as `@hashgraph/sdk`) required as a peer dependency by Agent Kit v4.*

### Kit Usage

**`HederaAgentAPI` instantiation** (`src/signal-agent/hederaSignalSender.ts`):
```typescript
import { HederaAgentAPI, HederaParameterNormaliser, HederaBuilder, handleTransaction, AgentMode } from "@hashgraph/hedera-agent-kit";
import { Client, AccountId, PrivateKey } from "@hiero-ledger/sdk";

const client = Client.forMainnet();
client.setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));

const context: Context = { accountId, mode: AgentMode.AUTONOMOUS };
const agentKit = new HederaAgentAPI(client, context);
```

**Transfer pipeline:**
```typescript
const normalised = await HederaParameterNormaliser.normaliseTransferHbar(rawParams, context, client);
const tx = HederaBuilder.transferHbar(normalised);
const result = await handleTransaction(tx, client, context); // AgentMode.AUTONOMOUS
```

**Tool discovery** (`src/signal-agent/signalAgentKit.ts`):
```typescript
import * as KitPlugins from "@hashgraph/hedera-agent-kit/plugins";

// Enumerate all 43 Kit tools at runtime from exported constants
export function listKitTools(): string[] {
  return Object.entries(KitPlugins)
    .filter(([key, value]) => key === key.toUpperCase() && key.endsWith("_TOOL") && typeof value === "string")
    .map(([, value]) => value as string);
}
```

**Kit tools wired to signal tools:**
| Signal Tool | Kit Tool |
|-------------|----------|
| `send_signal_tinybar` | `transfer_hbar_tool` (`KitPlugins.TRANSFER_HBAR_TOOL`) |
| `get_wallet_balance` | `get_hbar_balance_query_tool` (`KitPlugins.GET_HBAR_BALANCE_QUERY_TOOL`) |

---

## Real Transaction Evidence

The Signal Agent has executed real mainnet HBAR transfers. A successful 1-tinybar signal was sent from the FrameTab operator wallet (`0.0.10487520`) to an NFT owner, with the engagement memo written permanently to Hedera mainnet.

**To verify:**
1. Visit [HashScan Mainnet](https://hashscan.io/mainnet/account/0.0.10487520)
2. Look for outgoing transactions with memos starting `FrameTab signal:`
3. The transaction response includes `status: "SUCCESS"` and the permanent `transactionId`

> The live production system at https://app.frametab.gallery has the Signal Agent integrated into the admin dashboard, where the FrameTab team reviews and approves signal groups before each send.

---

## The Four Agent Tools

The pipeline is composed of four tools, two of which directly invoke Hedera Agent Kit functionality:

### Tool 1: `build_daily_signal_queue`
Aggregates favorites and watchlist additions from the platform database into per-NFT signal groups for a given date window. Builds the memo, resolves the owner, and flags any risk conditions (unresolvable owner, memo length overflow).

### Tool 2: `resolve_nft_owner`
Queries the Hedera Mirror Node REST API (`/tokens/{tokenId}/nfts/{serial}`) to resolve the current on-chain owner of an NFT. Re-run immediately before each send to catch ownership transfers.

### Tool 3: `send_signal_tinybar` ← Kit-backed
Uses `@hashgraph/hedera-agent-kit` to execute the HBAR transfer:
- `HederaParameterNormaliser.normaliseTransferHbar()` — validates and resolves parameters
- `HederaBuilder.transferHbar()` — constructs the `TransferTransaction`
- `handleTransaction()` in `AgentMode.AUTONOMOUS` — signs, submits, and awaits the receipt

### Tool 4: `get_wallet_balance` ← Kit-backed
Returns the operator wallet's current HBAR balance via the Hedera Mirror Node, using the `get_hbar_balance_query_tool` from the Kit's plugin registry.

---

## Human-in-the-Loop Design

The agent is deliberately non-autonomous for production sends. Every group requires explicit admin approval in the dashboard before a signal is dispatched. This design:

- Prevents accidental mass sends
- Allows the operator to review risk flags (unresolvable owners, ownership changes)
- Provides an audit trail (approvedBy, approvedAt) for every transaction

The `SIGNAL_REQUIRE_HUMAN_APPROVAL=true` flag (default) enforces this gate in the policy engine.

---

## Safety & Rate Limiting

| Control | Default | Description |
|---------|---------|-------------|
| `SIGNAL_AGENT_ENABLED` | `false` | Must be explicitly enabled |
| `SIGNAL_DRY_RUN_DEFAULT` | `true` | Logs without spending HBAR until disabled |
| `SIGNAL_REQUIRE_HUMAN_APPROVAL` | `true` | Admin must approve each group |
| `SIGNAL_MAX_OWNER_DAILY` | `5` | Max signals to one owner per day |
| `SIGNAL_MAX_GLOBAL_DAILY` | `200` | Max total daily sends |
| Blocked accounts table | — | Permanent opt-out list |
| Owner change detection | — | Blocks send if NFT sold since approval |

---

## Feedback Filed

Feedback on the `@hashgraph/hedera-agent-kit` package was filed as **[issue #836 on the hedera-agent-kit-js GitHub repository](https://github.com/hashgraph/hedera-agent-kit-js/issues/836)** during development, covering:

1. **`HederaAgentKit` vs `HederaAgentAPI`** — The exported class name is `HederaAgentAPI`, not `HederaAgentKit` as implied by the package name and most documentation. This caused initial confusion.
2. **`ToolDiscovery.getAllTools()` returns empty without registered plugins** — The runtime tool discovery method returns an empty array unless plugins are explicitly registered. The workaround (enumerating `UPPERCASE_TOOL` constants from the plugins export) works but isn't documented.
3. **Peer dependency requires `@hiero-ledger/sdk`** — The v4 Kit expects the rebranded SDK. Running with `@hashgraph/sdk` alone causes `INVALID_ACCOUNT_ID` or type mismatch errors at runtime.

---

## Links

| Resource | URL |
|----------|-----|
| Live demo | https://app.frametab.gallery |
| GitHub repo | https://github.com/ruark-xyz/frametab-signal-agent |
| HashScan operator wallet | https://hashscan.io/mainnet/account/0.0.10487520 |
| Hedera Agent Kit npm | https://www.npmjs.com/package/@hashgraph/hedera-agent-kit |
| Hedera Agent Kit repo | https://github.com/hashgraph/hedera-agent-kit-js |
| Feedback filed | https://github.com/hashgraph/hedera-agent-kit-js/issues/836 |
