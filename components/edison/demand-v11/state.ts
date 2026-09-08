import type { DemandAllowance, DemandIdea, DemandLoop, DemandRequest } from "@edison/contracts";

/** An accepted current set replaces its predecessor; pending work cannot replace it. */
export function currentLoopArticles(loop: DemandLoop, ideas: readonly DemandIdea[], requests: readonly DemandRequest[]) {
  const owned = ideas.filter((idea) => idea.loopId === loop.id);
  const authoritative = "currentBatchRequestId" in loop ? loop.currentBatchRequestId : undefined;
  if (authoritative === null) return [];
  const candidates = (authoritative ? owned.filter((idea) => idea.batchRequestId === authoritative) : owned)
    .filter((idea) => { const status = requests.find(({ id }) => id === idea.batchRequestId)?.status; return !status || status === "succeeded"; });
  // Compatibility for retained pre-v11 snapshots: ideas are admitted only after
  // acceptance. Prefer the newest saved nonempty batch, never a pending request.
  const newest = candidates.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.batchRequestId.localeCompare(a.batchRequestId))[0];
  if (!newest) return [];
  const batch = candidates.filter((idea) => idea.batchRequestId === newest.batchRequestId);
  const status = requests.find(({ id }) => id === newest.batchRequestId)?.status;
  if (status && status !== "succeeded") return [];
  return batch.toSorted((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

export function currentReadingArticles(loops: readonly DemandLoop[], ideas: readonly DemandIdea[], requests: readonly DemandRequest[]) {
  return loops.filter((loop) => !loop.archivedAt).flatMap((loop) => currentLoopArticles(loop, ideas, requests));
}

export type ArticleAllowance = DemandAllowance;

export function articleBalance(allowance: ArticleAllowance | null | undefined) {
  return allowance ? `${allowance.remaining} of ${allowance.limit} articles left this week` : "Article allowance unavailable";
}

export function nextArticleCount(allowance: ArticleAllowance | null | undefined) {
  return allowance ? Math.min(6, Math.max(0, allowance.available)) : null;
}

export function allowanceResetLabel(allowance: ArticleAllowance, locale?: string, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(allowance.resetsAt));
}
