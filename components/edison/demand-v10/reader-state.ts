import type { DemandIdea, DemandRequest } from "@edison/contracts";

/** Keep accepted cards in place; only append genuinely new server identities. */
export function appendStableIdeas(previous: readonly DemandIdea[], incoming: readonly DemandIdea[]) {
  const byId = new Map(incoming.map((idea) => [idea.id, idea]));
  const known = new Set(previous.map((idea) => idea.id));
  const appended = incoming.filter((idea) => !known.has(idea.id)).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.batchRequestId.localeCompare(b.batchRequestId) || a.rank - b.rank);
  return [...previous.map((idea) => byId.get(idea.id) ?? idea), ...appended];
}

export function articlePreparationLabel(request?: DemandRequest) {
  if (request?.stage === "writing") return "Writing your article…";
  if (request?.stage === "checking" || request?.stage === "repairing") return "Checking your article…";
  return "Preparing your article…";
}

export type LoopEditDraft = { name: string; instructions: string };
export function loopDraftChanged(draft: LoopEditDraft, saved: LoopEditDraft) {
  return draft.name !== saved.name || draft.instructions !== saved.instructions;
}

export function readScopedDraft<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 32000) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

export function saveScopedDraft(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep usable in-memory state. */ }
}
