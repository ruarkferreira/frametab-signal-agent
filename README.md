# FrameTab Signal Agent

> An agentic Hedera system that rewards NFT collectors by sending on-chain HBAR signals to current NFT owners, with engagement data encoded in public transaction memos.

**Live demo:** [www.frametab.gallery](https://www.frametab.gallery)  
**Bounty submission:** [docs/bounty-submission.md](./docs/bounty-submission.md)  
**Submission tweet:** [x.com/frametab/status/2057810726404702645](https://x.com/frametab/status/2057810726404702645?s=46)

---

## What It Does

When users favorite or add NFTs to their watchlist on [FrameTab](https://www.frametab.gallery), the Signal Agent:

1. **Detects engagement** — aggregates daily favorites + watchlist additions per NFT
2. **Resolves the current owner** — queries the Hedera Mirror Node for the live on-chain owner
3. **Builds a public memo** — encodes engagement data in a structured format (see below)
4. **Sends a 1-tinybar HBAR signal** — writes the memo permanently to Hedera mainnet
5. **Logs everything** — full transaction log with HashScan links, admin review, dry-run support

The result: every signal is a permanent, publicly auditable on-chain record that the NFT received engagement — visible to anyone on [HashScan](https://hashscan.io).

---

## On-Chain Memo Design

Every signal transaction carries a structured memo readable by any Hedera explorer:

```
FrameTab signal: {F}F {W}W {tokenId}#{serial}
```

**Example:**
```
FrameTab signal: 3F 12W 0.0.878200#42
```

| Part | Meaning |
|------|---------|
| `3F` | 3 favorites added that day |
| `12W` | 12 watchlist additions that day |
| `0.0.878200#42` | Token ID + Serial — identifies the specific NFT |

**Why this pattern?**
- Hedera transaction memos are limited to 100 bytes — the format is compact by design
- The memo is *public* and *permanent* — owners, collectors, and marketplaces can read it
- It proves provenance: this NFT was actively discovered and engaged with by real collectors

---

## Architecture

```
                    FrameTab Platform
                         │
              favorites & watchlist events
                         │
                         ▼
              ┌──────────────────────┐
              │  Signal Group Builder │  (Tool: build_daily_signal_queue)
              │  aggregates per-NFT  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Mirror Node Resolver │  (Tool: resolve_nft_owner)
              │  GET /tokens/{id}/   │
              │       nfts/{serial}  │
              └──────────┬───────────┘
                         │
                  ┌──────▼──────┐
                  │ Admin Review │  human-in-the-loop approval
                  │  Dashboard  │
                  └──────┬──────┘
                         │ approved
                         ▼
              ┌──────────────────────┐
              │  Policy Engine       │  rate limits, blocked accounts,
              │  checkSendPolicy()   │  owner-change detection
              └──────────┬───────────┘
                         │ policy passed
                         ▼
              ┌──────────────────────────────────────┐
              │  Hedera Agent Kit (HBAR Transfer)     │  (Tool: send_signal_tinybar)
              │                                       │
              │  HederaAgentAPI(client, context)      │
              │  → HederaParameterNormaliser           │
              │  → HederaBuilder.transferHbar()       │
              │  → handleTransaction() [AUTONOMOUS]   │
              └──────────┬───────────────────────────┘
                         │
                         ▼
                  Hedera Mainnet
              ┌──────────────────────┐
              │  Transaction Log     │  (Tool: get_wallet_balance)
              │  HashScan link       │  + Mirror Node balance check
              └──────────────────────┘
```

---

## The Four Agent Kit Tools

| Tool | Backed by | Description |
|------|-----------|-------------|
| `build_daily_signal_queue` | Custom | Aggregates DB engagement data into per-NFT signal groups |
| `resolve_nft_owner` | Mirror Node REST API | Resolves current on-chain NFT owner |
| `send_signal_tinybar` | `transfer_hbar_tool` (Kit) | Sends 1-tinybar HBAR with memo via Agent Kit |
| `get_wallet_balance` | `get_hbar_balance_query_tool` (Kit) | Reads operator wallet balance via Mirror Node |

The `send_signal_tinybar` tool uses the `@hashgraph/hedera-agent-kit` pipeline:
```typescript
const { agentKit, client, context } = buildHederaAgentKit();
const normalised = await HederaParameterNormaliser.normaliseTransferHbar(rawParams, context, client);
const tx = HederaBuilder.transferHbar(normalised);
const result = await handleTransaction(tx, client, context); // AgentMode.AUTONOMOUS
```

---

## Prerequisites

- Node.js 20+
- PostgreSQL database
- Hedera account with ECDSA secp256k1 key (standard for HashPack/Blade wallets)
- Small HBAR balance (each signal costs ~$0.0001 USD)

---

## Setup

```bash
# 1. Clone and install
git clone https://github.com/ruarkferreira/frametab-signal-agent
cd frametab-signal-agent
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, SIGNAL_OPERATOR_ACCOUNT_ID, SIGNAL_OPERATOR_PRIVATE_KEY

# 3. Push schema to your database
npm run db:push

# 4. Start the server
npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `SIGNAL_OPERATOR_ACCOUNT_ID` | ✅ | — | Hedera account ID (e.g. `0.0.1234`) |
| `SIGNAL_OPERATOR_PRIVATE_KEY` | ✅ | — | ECDSA hex private key (DER-encoded) |
| `SIGNAL_AGENT_NETWORK` | — | `mainnet` | `mainnet` or `testnet` |
| `SIGNAL_AGENT_ENABLED` | — | `false` | Must be `true` to enable live sends |
| `SIGNAL_DRY_RUN_DEFAULT` | — | `true` | `false` to send real transactions |
| `SIGNAL_REQUIRE_HUMAN_APPROVAL` | — | `true` | Require admin approval per group |
| `SIGNAL_AMOUNT_TINYBARS` | — | `1` | HBAR amount per signal in tinybars |
| `SIGNAL_MAX_BATCH_SIZE` | — | `50` | Max groups per batch send |
| `SIGNAL_MAX_OWNER_DAILY` | — | `5` | Max signals per owner per day |
| `SIGNAL_MAX_GLOBAL_DAILY` | — | `200` | Max total signals per day |
| `ADMIN_JWT_SECRET` | — | — | JWT signing secret for admin routes |
| `ADMIN_BYPASS` | — | `false` | `true` to skip auth in development |

---

## API Reference

All routes are prefixed with `/api` and require admin authentication (Bearer JWT, or set `ADMIN_BYPASS=true` for local dev).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/signal-agent/config` | Current config + Kit tool inventory |
| `GET` | `/api/signal-agent/wallet` | Operator wallet balance |
| `POST` | `/api/signal-agent/build-daily` | Build queue for `{ windowDate: "YYYY-MM-DD" }` |
| `GET` | `/api/signal-agent/groups?date=` | List signal groups for a date |
| `POST` | `/api/signal-agent/groups/:id/approve` | Approve a group for sending |
| `POST` | `/api/signal-agent/groups/:id/skip` | Skip a group |
| `POST` | `/api/signal-agent/groups/:id/refresh-owner` | Re-resolve NFT owner |
| `POST` | `/api/signal-agent/send/:id` | Send (or dry-run) a single group |
| `GET` | `/api/signal-agent/transactions` | Transaction log |

---

## Safety Design

The agent is built with several layers of protection against accidental or excessive sends:

- **Disabled by default** — `SIGNAL_AGENT_ENABLED=false` until explicitly enabled
- **Dry-run default** — `SIGNAL_DRY_RUN_DEFAULT=true` logs without spending HBAR
- **Human-in-the-loop** — `SIGNAL_REQUIRE_HUMAN_APPROVAL=true` requires admin sign-off per group
- **Owner change detection** — if the NFT was sold since approval, the send is blocked
- **Rate limits** — per-owner daily cap + global daily cap
- **Blocked accounts** — `signal_agent_blocked_accounts` table for opt-outs
- **Memo validation** — hard 100-byte limit enforced before submission

---

## Project Structure

```
src/
├── db/
│   ├── schema.ts          # Drizzle ORM schema (all signal agent tables)
│   └── index.ts           # DB connection
├── signal-agent/
│   ├── hederaSignalSender.ts    # Hedera Agent Kit integration + HBAR transfer
│   ├── signalAgentKit.ts        # Tool definitions + Kit tool discovery
│   ├── signalGroupService.ts    # Daily queue builder + group management
│   ├── signalPolicy.ts          # Policy engine + rate limiting
│   ├── mirrorNodeOwnerResolver.ts  # Hedera Mirror Node queries
│   └── memoBuilder.ts           # On-chain memo construction + validation
├── routes/
│   └── signalAgent.ts     # Express REST API routes
├── middleware/
│   └── adminAuth.ts       # JWT admin authentication
└── index.ts               # Server entry point
```

---

## License

MIT — built by [FrameTab](https://www.frametab.gallery) for the Hedera Agent AI Bounty Week 1.
