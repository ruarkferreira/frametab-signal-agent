import {
  db,
  favoritesTable,
  watchlistTable,
  signalAgentGroupsTable,
  signalAgentEventsTable,
} from "../db/index.js";
import { eq, and, gte, lt, count } from "drizzle-orm";
import { buildAndValidateMemo } from "./memoBuilder.js";
import { resolveNftOwner } from "./mirrorNodeOwnerResolver.js";

export interface SignalGroupRow {
  id: number;
  windowDate: string;
  tokenId: string;
  serial: number;
  ownerAccountId: string | null;
  favoriteCount: number;
  watchCount: number;
  memo: string | null;
  status: string;
  riskFlags: string[];
  approvedAt: Date | null;
  approvedBy: string | null;
  ownerResolvedAt: Date | null;
  ownerAtApprovalTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NftSignalCounts {
  tokenId: string;
  serial: number;
  favoriteCount: number;
  watchCount: number;
}

/**
 * Aggregates favorites and watchlist additions for a given UTC date window
 * into per-NFT signal counts.
 */
async function aggregateSignalCounts(windowDate: string): Promise<NftSignalCounts[]> {
  const dayStart = new Date(`${windowDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${windowDate}T23:59:59.999Z`);

  const [favRows, watchRows] = await Promise.all([
    db
      .select({
        tokenId: favoritesTable.tokenId,
        serial: favoritesTable.serial,
        cnt: count(),
      })
      .from(favoritesTable)
      .where(
        and(
          gte(favoritesTable.createdAt, dayStart),
          lt(favoritesTable.createdAt, dayEnd),
        ),
      )
      .groupBy(favoritesTable.tokenId, favoritesTable.serial),

    db
      .select({
        tokenId: watchlistTable.tokenId,
        serial: watchlistTable.serial,
        cnt: count(),
      })
      .from(watchlistTable)
      .where(
        and(
          gte(watchlistTable.createdAt, dayStart),
          lt(watchlistTable.createdAt, dayEnd),
        ),
      )
      .groupBy(watchlistTable.tokenId, watchlistTable.serial),
  ]);

  const map = new Map<string, NftSignalCounts>();

  for (const row of favRows) {
    const key = `${row.tokenId}#${row.serial}`;
    const existing = map.get(key) ?? {
      tokenId: row.tokenId,
      serial: row.serial,
      favoriteCount: 0,
      watchCount: 0,
    };
    existing.favoriteCount = Number(row.cnt);
    map.set(key, existing);
  }

  for (const row of watchRows) {
    const key = `${row.tokenId}#${row.serial}`;
    const existing = map.get(key) ?? {
      tokenId: row.tokenId,
      serial: row.serial,
      favoriteCount: 0,
      watchCount: 0,
    };
    existing.watchCount = Number(row.cnt);
    map.set(key, existing);
  }

  return Array.from(map.values()).filter((r) => r.favoriteCount + r.watchCount > 0);
}

/**
 * Builds the daily signal queue for a given date.
 * For each NFT with activity, resolves the current on-chain owner,
 * validates the memo, and upserts a signal group row for admin review.
 */
export async function buildDailySignalQueue(
  windowDate: string,
  adminId?: string,
): Promise<{ built: number; skipped: number }> {
  const counts = await aggregateSignalCounts(windowDate);
  let built = 0;
  let skipped = 0;

  for (const nft of counts) {
    const memoResult = buildAndValidateMemo({
      tokenId: nft.tokenId,
      serial: nft.serial,
      favoriteCount: nft.favoriteCount,
      watchCount: nft.watchCount,
    });

    const ownerResult = await resolveNftOwner(nft.tokenId, nft.serial);
    const riskFlags: string[] = [];

    if (!ownerResult) {
      riskFlags.push("owner_unresolvable");
    }

    if (!memoResult.ok) {
      riskFlags.push(...memoResult.errors.map((e) => `memo_error: ${e}`));
    }

    await db
      .insert(signalAgentGroupsTable)
      .values({
        windowDate,
        tokenId: nft.tokenId,
        serial: nft.serial,
        ownerAccountId: ownerResult?.accountId ?? null,
        favoriteCount: nft.favoriteCount,
        watchCount: nft.watchCount,
        memo: memoResult.ok ? memoResult.memo : null,
        status: riskFlags.length > 0 ? "flagged" : "pending",
        riskFlags,
        ownerResolvedAt: ownerResult ? ownerResult.resolvedAt : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          signalAgentGroupsTable.windowDate,
          signalAgentGroupsTable.tokenId,
          signalAgentGroupsTable.serial,
        ],
        set: {
          ownerAccountId: ownerResult?.accountId ?? null,
          favoriteCount: nft.favoriteCount,
          watchCount: nft.watchCount,
          memo: memoResult.ok ? memoResult.memo : null,
          riskFlags,
          ownerResolvedAt: ownerResult ? ownerResult.resolvedAt : null,
          updatedAt: new Date(),
        },
      });

    await db.insert(signalAgentEventsTable).values({
      tokenId: nft.tokenId,
      serial: nft.serial,
      action: "queue_built",
      source: adminId ?? "system",
      meta: { windowDate, favoriteCount: nft.favoriteCount, watchCount: nft.watchCount },
    });

    built++;
  }

  return { built, skipped };
}

export async function getSignalGroups(windowDate: string): Promise<SignalGroupRow[]> {
  const rows = await db
    .select()
    .from(signalAgentGroupsTable)
    .where(eq(signalAgentGroupsTable.windowDate, windowDate));

  return rows.map((r) => ({
    ...r,
    riskFlags: (r.riskFlags ?? []) as string[],
  }));
}

export async function approveSignalGroup(
  groupId: number,
  adminId: string,
): Promise<SignalGroupRow | null> {
  const existing = await db
    .select()
    .from(signalAgentGroupsTable)
    .where(eq(signalAgentGroupsTable.id, groupId))
    .limit(1);

  if (!existing[0]) return null;

  const updated = await db
    .update(signalAgentGroupsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: adminId,
      ownerAtApprovalTime: existing[0].ownerAccountId,
      updatedAt: new Date(),
    })
    .where(eq(signalAgentGroupsTable.id, groupId))
    .returning();

  if (updated[0]) {
    await db.insert(signalAgentEventsTable).values({
      tokenId: updated[0].tokenId,
      serial: updated[0].serial,
      action: "approved",
      source: adminId,
      meta: { groupId },
    });
  }

  return updated[0]
    ? { ...updated[0], riskFlags: (updated[0].riskFlags ?? []) as string[] }
    : null;
}

export async function skipSignalGroup(
  groupId: number,
  adminId: string,
): Promise<SignalGroupRow | null> {
  const updated = await db
    .update(signalAgentGroupsTable)
    .set({ status: "skipped", updatedAt: new Date() })
    .where(eq(signalAgentGroupsTable.id, groupId))
    .returning();

  if (updated[0]) {
    await db.insert(signalAgentEventsTable).values({
      tokenId: updated[0].tokenId,
      serial: updated[0].serial,
      action: "skipped",
      source: adminId,
      meta: { groupId },
    });
  }

  return updated[0]
    ? { ...updated[0], riskFlags: (updated[0].riskFlags ?? []) as string[] }
    : null;
}

export async function refreshGroupOwner(groupId: number): Promise<SignalGroupRow | null> {
  const existing = await db
    .select()
    .from(signalAgentGroupsTable)
    .where(eq(signalAgentGroupsTable.id, groupId))
    .limit(1);

  if (!existing[0]) return null;
  const group = existing[0];

  const ownerResult = await resolveNftOwner(group.tokenId, group.serial);
  if (!ownerResult)
    return { ...group, riskFlags: (group.riskFlags ?? []) as string[] };

  const ownerChanged =
    group.status === "approved" &&
    group.ownerAtApprovalTime !== null &&
    ownerResult.accountId !== group.ownerAtApprovalTime;

  const existingFlags = (group.riskFlags ?? []) as string[];
  const newFlags = existingFlags.filter(
    (f) => f !== "owner_unresolvable" && f !== "owner_changed_requires_review",
  );
  if (ownerChanged) newFlags.push("owner_changed_requires_review");

  const updated = await db
    .update(signalAgentGroupsTable)
    .set({
      ownerAccountId: ownerResult.accountId,
      ownerResolvedAt: ownerResult.resolvedAt,
      riskFlags: newFlags,
      status: ownerChanged ? "requires_review" : group.status,
      updatedAt: new Date(),
    })
    .where(eq(signalAgentGroupsTable.id, groupId))
    .returning();

  return updated[0]
    ? { ...updated[0], riskFlags: (updated[0].riskFlags ?? []) as string[] }
    : null;
}
