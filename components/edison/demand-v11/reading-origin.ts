import { demandIdeaSchema, type DemandIdea } from "@edison/contracts";
import type { DemandOrigin } from "../demand-v10/route-continuity";

export type ReadingSet = { workspaceId: string; originIdeaId: string; view: "home" | "loop"; loopId: string | null; ideas: DemandIdea[] };
export function readingSetMatches(value: ReadingSet | null, workspaceId: string, origin: DemandOrigin) {
  return Boolean(value && !origin.history && value.workspaceId === workspaceId && value.originIdeaId === origin.ideaId && value.view === origin.view && value.loopId === origin.loopId);
}
export function parseReadingSet(raw: string | null, workspaceId: string, origin: DemandOrigin): ReadingSet | null {
  if (!raw || raw.length > 800_000 || !origin.ideaId || origin.history || !["home", "loop"].includes(origin.view)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<ReadingSet>;
    if (item.workspaceId !== workspaceId || item.originIdeaId !== origin.ideaId || item.view !== origin.view || item.loopId !== origin.loopId || !Array.isArray(item.ideas) || item.ideas.length > 600) return null;
    const parsed = demandIdeaSchema.array().safeParse(item.ideas);
    if (!parsed.success || !parsed.data.some(({ id }) => id === origin.ideaId) || new Set(parsed.data.map(({ id }) => id)).size !== parsed.data.length) return null;
    if (origin.view === "loop" && parsed.data.some(({ loopId }) => loopId !== origin.loopId)) return null;
    return { workspaceId, originIdeaId: origin.ideaId, view: origin.view as "home" | "loop", loopId: origin.loopId, ideas: parsed.data };
  } catch { return null; }
}
export function storeReadingSet(value: ReadingSet) {
  try { sessionStorage.setItem(`edison:demand:reading-set:${value.workspaceId}:${value.originIdeaId}`, JSON.stringify(value)); } catch { /* Current in-memory set is still retained. */ }
}
export function readReadingSet(workspaceId: string, origin: DemandOrigin) {
  try { return parseReadingSet(sessionStorage.getItem(`edison:demand:reading-set:${workspaceId}:${origin.ideaId}`), workspaceId, origin); } catch { return null; }
}
export function sameReadingSet(left: readonly DemandIdea[], right: readonly DemandIdea[]) {
  return left.length === right.length && left.every((idea, index) => idea.id === right[index]?.id);
}
