import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { demandIdeas, demandLoops, demandRequests, withDemandDb, type DemandTransaction } from "@edison/db";
import {
  DEMAND_HISTORY_PAGE_SIZE, demandHistoryCursorSchema, demandHistoryQuerySchema,
  demandHistorySchema, demandIdeaResultSchema, uuidSchema, type DemandHistoryQuery,
} from "@edison/contracts";
import { demandOwnerIds, demandWorkspaceId, type DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";
import {
  demandIdeaDto, demandRequestDto, demandIdeaSummarySelection, demandRequestSummarySelection,
} from "./demand-reading";

const cursorPayloadSchema = z.object({
  version: z.literal(1), workspaceId: uuidSchema, scope: z.enum(["all", "saved"]),
  loopId: uuidSchema.nullable(), anchorId: uuidSchema,
}).strict();

function invalidCursor() {
  return new HttpError(400, "invalid_history_cursor", "That reading history position is not valid. Start from the latest reading.");
}

/** A cursor is an untrusted locator, not an authorization credential. */
export function encodeDemandHistoryCursor(workspaceId: string, input: DemandHistoryQuery, anchorId: string) {
  return Buffer.from(JSON.stringify(cursorPayloadSchema.parse({
    version: 1, workspaceId, scope: input.scope, loopId: input.loopId ?? null, anchorId,
  }))).toString("base64url");
}

export function decodeDemandHistoryCursor(workspaceId: string, input: DemandHistoryQuery) {
  if (!input.cursor) return null;
  try {
    const token = demandHistoryCursorSchema.parse(input.cursor);
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) throw invalidCursor();
    const cursor = cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (cursor.workspaceId !== workspaceId || cursor.scope !== input.scope || cursor.loopId !== (input.loopId ?? null)) throw invalidCursor();
    return cursor.anchorId;
  } catch { throw invalidCursor(); }
}

async function assertActiveReader(tx: DemandTransaction, workspaceId: string) {
  const [row] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${workspaceId}::uuid) as active`);
  if (row?.active !== true) throw new HttpError(401, "reading_session_expired", "This reading session is no longer available.");
}

/** Bounded keyset pagination over immutable creation time, rank and identity. */
export async function demandHistory(principal: DemandPrincipal, rawInput: DemandHistoryQuery) {
  const input = demandHistoryQuerySchema.parse(rawInput);
  const workspaceId = demandWorkspaceId(principal);
  const owners = demandOwnerIds(principal);
  const anchorId = decodeDemandHistoryCursor(workspaceId, input);
  return withDemandDb(workspaceId, async (tx) => {
    await assertActiveReader(tx, workspaceId);
    if (input.loopId) {
      const [loop] = await tx.select({ id: demandLoops.id }).from(demandLoops)
        .where(and(inArray(demandLoops.principalId, owners), eq(demandLoops.id, input.loopId))).limit(1);
      if (!loop) throw new HttpError(404, "loop_not_found", "That learning loop was not found.");
    }
    const ownership = and(inArray(demandIdeas.principalId, owners), input.loopId ? eq(demandIdeas.loopId, input.loopId) : undefined);
    const [anchor] = anchorId ? await tx.select({
      id: demandIdeas.id, rank: demandIdeas.rank,
      // PostgreSQL can retain microseconds that a JavaScript Date would drop.
      createdAt: sql<string>`${demandIdeas.createdAt}::text`,
    }).from(demandIdeas).where(and(ownership, eq(demandIdeas.id, anchorId))).limit(1) : [];
    if (anchorId && !anchor) throw invalidCursor();
    // Do not require the anchor to remain saved: an unsave between pages must
    // not invalidate an otherwise owned, immutable history position.
    const rows = await tx.select(demandIdeaSummarySelection).from(demandIdeas).where(and(
      ownership,
      input.scope === "saved" ? eq(demandIdeas.saved, true) : undefined,
      anchor ? sql`(${demandIdeas.createdAt}, -${demandIdeas.rank}, ${demandIdeas.id}) <
        (${anchor.createdAt}::timestamptz, -${anchor.rank}::integer, ${anchor.id}::uuid)` : undefined,
    )).orderBy(desc(demandIdeas.createdAt), asc(demandIdeas.rank), desc(demandIdeas.id)).limit(DEMAND_HISTORY_PAGE_SIZE + 1);
    const page = rows.slice(0, DEMAND_HISTORY_PAGE_SIZE);
    const articleIds = [...new Set(page.flatMap((row) => row.articleRequestId ? [row.articleRequestId] : []))];
    const requests = articleIds.length ? await tx.select(demandRequestSummarySelection).from(demandRequests).where(and(
      inArray(demandRequests.principalId, owners), eq(demandRequests.kind, "article"),
      inArray(demandRequests.id, articleIds), inArray(demandRequests.ideaId, page.map((row) => row.id)),
    )).limit(DEMAND_HISTORY_PAGE_SIZE) : [];
    return demandHistorySchema.parse({
      workspaceId, ideas: page.map(demandIdeaDto), requests: requests.map(demandRequestDto),
      nextCursor: rows.length > DEMAND_HISTORY_PAGE_SIZE
        ? encodeDemandHistoryCursor(workspaceId, input, page[page.length - 1].id) : null,
    });
  });
}

/** Exact recovery never commissions work and is independent of workspace caps. */
export async function demandIdeaResult(principal: DemandPrincipal, rawIdeaId: string) {
  const ideaId = uuidSchema.parse(rawIdeaId);
  return withDemandDb(principal.id, async (tx) => {
    await assertActiveReader(tx, principal.id);
    const [idea] = await tx.select(demandIdeaSummarySelection).from(demandIdeas).where(and(
      eq(demandIdeas.principalId, principal.id), eq(demandIdeas.id, ideaId),
    )).limit(1);
    if (!idea) throw new HttpError(404, "idea_not_found", "That article idea was not found.");
    const [request] = idea.articleRequestId ? await tx.select(demandRequestSummarySelection).from(demandRequests).where(and(
      eq(demandRequests.principalId, principal.id), eq(demandRequests.id, idea.articleRequestId),
      eq(demandRequests.ideaId, idea.id), eq(demandRequests.kind, "article"),
    )).limit(1) : [];
    return demandIdeaResultSchema.parse({
      workspaceId: demandWorkspaceId(principal), idea: demandIdeaDto(idea), request: request ? demandRequestDto(request) : null,
    });
  });
}
