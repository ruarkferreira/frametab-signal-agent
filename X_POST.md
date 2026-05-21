# X / Twitter Post Copy

Use the text below. Post the first tweet, then reply to it with the thread continuation.

---

## Tweet 1 (main post)

```
We built an agentic Hedera system that rewards NFT collectors with on-chain signals 🛠️

FrameTab Signal Agent detects daily engagement (favorites + watchlists) and automatically sends 1-tinybar HBAR to each NFT owner with a public memo:

"FrameTab signal: 3F 12W 0.0.878200#42"

Powered by @hashgraph's official hedera-agent-kit 👇

#HederaAgent #HederaAIBounty @hedera @hedera_devs
```

---

## Tweet 2 (thread reply to Tweet 1)

```
The pipeline:

1️⃣ resolve_nft_owner — queries the Mirror Node for the live on-chain owner
2️⃣ build_daily_signal_queue — aggregates favorites + watchlist data per NFT
3️⃣ send_signal_tinybar — executes the HBAR transfer via hedera-agent-kit's transfer_hbar_tool
4️⃣ get_wallet_balance — reads operator balance via get_hbar_balance_query_tool

Human-in-the-loop approval before every send. Fully auditable on HashScan.
```

---

## Tweet 3 (thread reply to Tweet 2)

```
Built with:
• @hashgraph/hedera-agent-kit v4 (HederaAgentAPI + handleTransaction)
• @hiero-ledger/sdk (Hedera rebranded SDK)
• Drizzle ORM + PostgreSQL for the signal queue
• Human approval dashboard for admin review

Full source + bounty write-up on GitHub →
https://github.com/ruark-xyz/frametab-signal-agent

Live demo → https://app.frametab.gallery

#HederaAgent #HederaAIBounty
```

---

## Shorter single-tweet option (if you prefer one post)

```
Just shipped FrameTab Signal Agent — an agentic Hedera system that sends on-chain HBAR signals to NFT owners with public memo-encoded engagement data, powered by @hashgraph's hedera-agent-kit 🛠️

Source: https://github.com/ruark-xyz/frametab-signal-agent
Demo: https://app.frametab.gallery

#HederaAgent #HederaAIBounty @hedera @hedera_devs
```
