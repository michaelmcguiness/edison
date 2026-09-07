import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { demandIdeas, demandLoops, demandRequests, withDemandDb, type DemandTransaction } from "@edison/db";
import {
  DEMAND_CONVERSATION_PAGE_SIZE, demandArticleResultSchema, demandConversationQuerySchema,
  demandConversationSchema, demandConversationTurnSchema, demandHistoryCursorSchema, uuidSchema,
  type DemandConversationQuery,
} from "@edison/contracts";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";
import { demandIdeaDto, demandLoopDto, demandIdeaSummarySelection, demandRequestDto, demandRequestSummarySelection,
  demandRequestWithRecovery, type DemandRequestRow } from "./demand-reading";
import { recoverableDemandCheckIds } from "./demand-check-recovery";

const cursorSchema = z.object({ version: z.literal(1), workspaceId: uuidSchema, articleId: uuidSchema, anchorId: uuidSchema }).strict();
function invalidCursor() { return new HttpError(400, "invalid_conversation_cursor", "That conversation position is not valid. Open the latest conversation."); }
export function encodeDemandConversationCursor(workspaceId: string, articleId: string, anchorId: string) {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ version: 1, workspaceId, articleId, anchorId }))).toString("base64url");
}
export function decodeDemandConversationCursor(workspaceId: string, articleId: string, cursor?: string) {
  if (!cursor) return null;
  try {
    const bytes = Buffer.from(demandHistoryCursorSchema.parse(cursor), "base64url");
    if (bytes.toString("base64url") !== cursor) throw invalidCursor();
    const data = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (data.workspaceId !== workspaceId || data.articleId !== articleId) throw invalidCursor();
    return data.anchorId;
  } catch { throw invalidCursor(); }
}

async function ownedArticle(tx: DemandTransaction, principalId: string, articleId: string) {
  const [active] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
  if (active?.active !== true) throw new HttpError(401, "reading_session_expired", "This reading session is no longer available.");
  const [request] = await tx.select({ ...demandRequestSummarySelection, result: demandRequests.result }).from(demandRequests)
    .where(and(eq(demandRequests.principalId, principalId), eq(demandRequests.id, articleId), eq(demandRequests.kind, "article"))).limit(1);
  if (!request) throw new HttpError(404, "article_not_found", "That article was not found in your reading.");
  if (request.status !== "succeeded" || !request.result?.article) throw new HttpError(409, "article_not_ready", "That article is not ready to read yet.");
  return request;
}

/** An exact, owner-only read independent of loop navigation and workspace caps. */
export async function demandArticleResult(principal: DemandPrincipal, rawArticleId: string) {
  const articleId = uuidSchema.parse(rawArticleId);
  return withDemandDb(principal.id, async (tx) => {
    const request = await ownedArticle(tx, principal.id, articleId);
    const [idea] = await tx.select(demandIdeaSummarySelection).from(demandIdeas).where(and(
      eq(demandIdeas.principalId, principal.id), eq(demandIdeas.id, request.ideaId!), eq(demandIdeas.articleRequestId, articleId),
    )).limit(1);
    if (!idea) throw new HttpError(404, "article_not_found", "That article was not found in your reading.");
    const [loop] = await tx.select().from(demandLoops).where(and(eq(demandLoops.principalId, principal.id), eq(demandLoops.id, idea.loopId))).limit(1);
    if (!loop) throw new HttpError(404, "article_not_found", "That article was not found in your reading.");
    return demandArticleResultSchema.parse({ workspaceId: principal.id, idea: demandIdeaDto(idea),
      request: demandRequestDto(request), article: request.result!.article, loop: demandLoopDto(loop) });
  });
}

export function demandConversationTurn(row: Pick<DemandRequestRow,
  "id" | "loopId" | "ideaId" | "kind" | "status" | "stage" | "failureCode" | "createdAt" | "updatedAt"> & {
    question: unknown; answer: unknown; createdAtPrecise?: string; updatedAtPrecise?: string;
  }) {
  const request = demandRequestDto(row);
  return demandConversationTurnSchema.parse({ request: { ...request,
    createdAt: row.createdAtPrecise ?? request.createdAt, updatedAt: row.updatedAtPrecise ?? request.updatedAt }, question: row.question,
    answer: row.status === "succeeded" ? row.answer : null });
}

/** Display history is unbounded via keyset pages; AI context stays at six exchanges. */
export async function demandConversation(principal: DemandPrincipal, rawArticleId: string, rawInput: DemandConversationQuery = {}) {
  const articleId = uuidSchema.parse(rawArticleId);
  const input = demandConversationQuerySchema.parse(rawInput);
  const anchorId = decodeDemandConversationCursor(principal.id, articleId, input.cursor);
  const page = await withDemandDb(principal.id, async (tx) => {
    const article = await ownedArticle(tx, principal.id, articleId);
    const ownership = and(eq(demandRequests.principalId, principal.id), eq(demandRequests.ideaId, article.ideaId!),
      eq(demandRequests.kind, "question"), sql`${demandRequests.snapshot}->'question'->>'articleVersion' = ${articleId}`);
    const [anchor] = anchorId ? await tx.select({ id: demandRequests.id, createdAt: sql<string>`${demandRequests.createdAt}::text` })
      .from(demandRequests).where(and(ownership, eq(demandRequests.id, anchorId))).limit(1) : [];
    if (anchorId && !anchor) throw invalidCursor();
    // Project only the two public-to-owner fields. Raw snapshots never leave DB.
    const rows = await tx.select({ ...demandRequestSummarySelection,
      // Keep submillisecond ordering when the client merges earlier pages.
      createdAtPrecise: sql<string>`to_char(${demandRequests.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      updatedAtPrecise: sql<string>`to_char(${demandRequests.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      question: sql<unknown>`${demandRequests.snapshot}->'question'->>'question'`,
      answer: sql<unknown>`${demandRequests.result}->'answer'`,
    }).from(demandRequests).where(and(ownership, anchor ? sql`(${demandRequests.createdAt}, ${demandRequests.id}) <
      (${anchor.createdAt}::timestamptz, ${anchor.id}::uuid)` : undefined))
      .orderBy(desc(demandRequests.createdAt), desc(demandRequests.id)).limit(DEMAND_CONVERSATION_PAGE_SIZE + 1);
    const selected = rows.slice(0, DEMAND_CONVERSATION_PAGE_SIZE);
    return demandConversationSchema.parse({ workspaceId: principal.id, articleId,
      nextCursor: rows.length > DEMAND_CONVERSATION_PAGE_SIZE
        ? encodeDemandConversationCursor(principal.id, articleId, selected[selected.length - 1].id) : null,
      turns: selected.reverse().map(demandConversationTurn) });
  });
  const eligible = await recoverableDemandCheckIds(principal.id, page.turns.filter((turn) =>
    turn.request.failure?.code === "provider_invalid").map((turn) => turn.request.id));
  return { ...page, turns: page.turns.map((turn) => ({ ...turn,
    request: demandRequestWithRecovery(turn.request, eligible.has(turn.request.id)) })) };
}
