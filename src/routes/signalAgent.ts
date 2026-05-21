import { Router } from "express";
import {
  db,
  signalAgentGroupsTable,
  signalAgentTransactionsTable,
} from "../db/index.js";
import { eq, desc, and, gte, count } from "drizzle-orm";
import { requireAdmin } from "../middleware/adminAuth.js";
import { loadPolicyConfig, hasWalletSecrets, checkSendPolicy } from "../signal-agent/signalPolicy.js";
import { resolveNftOwner, getWalletBalance } from "../signal-agent/mirrorNodeOwnerResolver.js";
import {
  buildDailySignalQueue,
  getSignalGroups,
  approveSignalGroup,
  skipSignalGroup,
  refreshGroupOwner,
} from "../signal-agent/signalGroupService.js";
import { sendSignalTransaction } from "../signal-agent/hederaSignalSender.js";
import { SIGNAL_AGENT_TOOLS, listKitTools } from "../signal-agent/signalAgentKit.js";

const router = Router();

router.use("/signal-agent", requireAdmin);

/** Returns current config, policy, and discovered Agent Kit tool inventory. */
router.get("/signal-agent/config", (_req, res) => {
  const config = loadPolicyConfig();
  res.json({
    enabled: config.enabled,
    network: config.network,
    operatorAccountId: config.operatorAccountId,
    amountTinybars: config.amountTinybars,
    requireHumanApproval: config.requireHumanApproval,
    dryRunDefault: config.dryRunDefault,
    maxBatchSize: config.maxBatchSize,
    maxOwnerDaily: config.maxOwnerDaily,
    maxGlobalDaily: config.maxGlobalDaily,
    hasWalletSecrets: hasWalletSecrets(),
    estimatedFeeUsd: process.env.SIGNAL_ESTIMATED_CRYPTO_TRANSFER_FEE_USD ?? "0.0001",
    agentTools: SIGNAL_AGENT_TOOLS.map((t) => t.name),
    kitTools: listKitTools(),
  });
});

/** Returns the operator wallet balance via Mirror Node. */
router.get("/signal-agent/wallet", async (_req, res) => {
  try {
    const config = loadPolicyConfig();
    if (!config.operatorAccountId) {
      res.json({ accountId: null, balance: null, hasSecrets: false });
      return;
    }
    const balance = await getWalletBalance(config.operatorAccountId);
    const estFeeUsd = parseFloat(
      process.env.SIGNAL_ESTIMATED_CRYPTO_TRANSFER_FEE_USD ?? "0.0001",
    );
    const estimatedSends =
      balance !== null && estFeeUsd > 0
        ? Math.floor(balance / 100_000_000 / estFeeUsd)
        : null;
    res.json({
      accountId: config.operatorAccountId,
      network: config.network,
      balanceTinybars: balance,
      balanceHbar: balance !== null ? balance / 100_000_000 : null,
      estimatedSends,
      hasSecrets: hasWalletSecrets(),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[signal-agent] GET /wallet error:", err);
    res.status(500).json({ error: "Failed to fetch wallet info" });
  }
});

/** Builds the daily signal queue for a given date. */
router.post("/signal-agent/build-daily", async (req, res) => {
  try {
    const { windowDate } = req.body as { windowDate?: string };
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      res.status(400).json({ error: "windowDate (YYYY-MM-DD) is required" });
      return;
    }
    const adminId = (req as any).adminId ?? "admin";
    const result = await buildDailySignalQueue(windowDate, adminId);
    res.json({ ok: true, windowDate, ...result });
  } catch (err) {
    console.error("[signal-agent] POST /build-daily error:", err);
    res.status(500).json({ error: "Failed to build daily signal queue" });
  }
});

/** Lists signal groups for a given date. */
router.get("/signal-agent/groups", async (req, res) => {
  try {
    const { date } = req.query as { date?: string };
    const windowDate = date ?? new Date().toISOString().slice(0, 10);
    const groups = await getSignalGroups(windowDate);
    res.json(groups);
  } catch (err) {
    console.error("[signal-agent] GET /groups error:", err);
    res.status(500).json({ error: "Failed to fetch signal groups" });
  }
});

/** Approves a signal group for sending. */
router.post("/signal-agent/groups/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const adminId = (req as any).adminId ?? "admin";
    const updated = await approveSignalGroup(id, adminId);
    if (!updated) {
      res.status(404).json({ error: "Signal group not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("[signal-agent] POST /groups/:id/approve error:", err);
    res.status(500).json({ error: "Failed to approve signal group" });
  }
});

/** Skips a signal group. */
router.post("/signal-agent/groups/:id/skip", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const adminId = (req as any).adminId ?? "admin";
    const updated = await skipSignalGroup(id, adminId);
    if (!updated) {
      res.status(404).json({ error: "Signal group not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("[signal-agent] POST /groups/:id/skip error:", err);
    res.status(500).json({ error: "Failed to skip signal group" });
  }
});

/** Re-resolves the current NFT owner for a group. */
router.post("/signal-agent/groups/:id/refresh-owner", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await refreshGroupOwner(id);
    if (!updated) {
      res.status(404).json({ error: "Signal group not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("[signal-agent] POST /groups/:id/refresh-owner error:", err);
    res.status(500).json({ error: "Failed to refresh owner" });
  }
});

/** Sends (or dry-runs) a signal for a single approved group. */
router.post("/signal-agent/send/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { isDryRun } = req.body as { isDryRun?: boolean };
    const adminId = (req as any).adminId ?? "admin";

    const group = await db
      .select()
      .from(signalAgentGroupsTable)
      .where(eq(signalAgentGroupsTable.id, id))
      .limit(1);

    if (!group[0]) {
      res.status(404).json({ error: "Signal group not found" });
      return;
    }
    const g = group[0];

    if (!g.ownerAccountId || !g.memo) {
      res.status(400).json({ error: "Group is missing owner or memo — re-build and try again" });
      return;
    }

    const freshOwner = await resolveNftOwner(g.tokenId, g.serial);
    const ownerChangedSinceApproval =
      g.status === "approved" &&
      g.ownerAtApprovalTime !== null &&
      (freshOwner?.accountId ?? null) !== g.ownerAtApprovalTime;

    if (ownerChangedSinceApproval) {
      await db
        .update(signalAgentGroupsTable)
        .set({
          status: "requires_review",
          ownerAccountId: freshOwner?.accountId ?? g.ownerAccountId,
          updatedAt: new Date(),
        })
        .where(eq(signalAgentGroupsTable.id, id));
      res.status(409).json({ error: "NFT owner changed since approval. Re-resolve and re-approve." });
      return;
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [ownerDailyCount, globalDailyCount] = await Promise.all([
      db
        .select({ cnt: count() })
        .from(signalAgentTransactionsTable)
        .where(
          and(
            eq(signalAgentTransactionsTable.recipientAccountId, g.ownerAccountId),
            eq(signalAgentTransactionsTable.status, "success"),
            gte(signalAgentTransactionsTable.createdAt, todayStart),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(signalAgentTransactionsTable)
        .where(
          and(
            eq(signalAgentTransactionsTable.status, "success"),
            gte(signalAgentTransactionsTable.createdAt, todayStart),
          ),
        ),
    ]);

    const policy = await checkSendPolicy({
      recipientAccountId: g.ownerAccountId,
      memo: g.memo,
      batchSendCount: 1,
      ownerDailyCount: Number(ownerDailyCount[0]?.cnt ?? 0),
      globalDailyCount: Number(globalDailyCount[0]?.cnt ?? 0),
      isApproved: g.status === "approved",
      ownerChangedSinceApproval: false,
    });

    if (!policy.ok) {
      res.status(400).json({ error: "Policy check failed", details: policy.errors });
      return;
    }

    const result = await sendSignalTransaction({
      groupId: g.id,
      tokenId: g.tokenId,
      serial: g.serial,
      recipientAccountId: freshOwner?.accountId ?? g.ownerAccountId,
      memo: g.memo,
      isDryRun,
      initiatedBy: adminId,
    });

    if (result.ok) {
      await db
        .update(signalAgentGroupsTable)
        .set({ status: result.isDryRun ? "dry_run_ok" : "sent", updatedAt: new Date() })
        .where(eq(signalAgentGroupsTable.id, id));
    }

    res.json(result);
  } catch (err) {
    console.error("[signal-agent] POST /send/:id error:", err);
    res.status(500).json({ error: "Failed to send signal" });
  }
});

/** Returns recent transaction log entries. */
router.get("/signal-agent/transactions", async (req, res) => {
  try {
    const limit = Math.min(200, parseInt((req.query.limit as string) ?? "50", 10) || 50);
    const rows = await db
      .select()
      .from(signalAgentTransactionsTable)
      .orderBy(desc(signalAgentTransactionsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    console.error("[signal-agent] GET /transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
