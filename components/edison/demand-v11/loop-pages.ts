import type { DemandIdea, DemandLoop, DemandLoops, DemandRequest, DemandResult, DemandWorkspace } from "@edison/contracts";
import { mergeDemandLoops } from "@/lib/demand-reader-state";

function mergeRows<T extends { id: string }>(earlier: readonly T[], later: readonly T[], newer: (left: T, right: T) => T) {
  const rows = new Map(earlier.map((row) => [row.id, row]));
  for (const row of later) rows.set(row.id, rows.has(row.id) ? newer(rows.get(row.id)!, row) : row);
  return [...rows.values()];
}
export function mergeLoopPage(previous: DemandLoops | null, page: DemandLoops): DemandLoops {
  if (!previous || previous.workspaceId !== page.workspaceId) return page;
  const ideas = mergeRows(previous.ideas, page.ideas, (_a, b) => b);
  const requests = mergeRows(previous.requests, page.requests, (a, b) => a.updatedAt > b.updatedAt ? a : b);
  return { ...page, ideas, requests, loops: mergeDemandLoops(previous.loops, page.loops, ideas, requests) };
}
/** A local rendering projection, never re-parsed or published as a bounded server response. */
export function loopProjection(workspace: DemandWorkspace | null, pages: DemandLoops | null): { loops: DemandLoop[]; ideas: DemandIdea[]; requests: DemandRequest[] } {
  if (!workspace) return { loops: [], ideas: [], requests: [] };
  if (!pages || pages.workspaceId !== workspace.workspaceId) return workspace;
  return mergeLoopPage(pages, { workspaceId: workspace.workspaceId, loops: workspace.loops, ideas: workspace.ideas, requests: workspace.requests, nextCursor: pages.nextCursor });
}
export function offWindowPendingLoops(workspace: DemandWorkspace, requests: readonly DemandRequest[], submitted: Iterable<string>) {
  return [...new Set([...submitted, ...requests.filter((request) => request.kind === "ideas" && (request.status === "queued" || request.status === "running")).map((request) => request.loopId)])]
    .filter((loopId) => !workspace.loops.some((loop) => loop.id === loopId));
}
export async function recoverCreatedLoop(requestId: string, workspaceId: string, getResult: (id: string) => Promise<DemandResult>, getLoop: (id: string) => Promise<DemandLoops>) {
  const result = await getResult(requestId);
  if (result.request.id !== requestId || result.request.kind !== "ideas") throw new Error("The new loop’s request could not be confirmed.");
  const page = await getLoop(result.request.loopId);
  if (page.workspaceId !== workspaceId || !page.loops.some((loop) => loop.id === result.request.loopId)) throw new Error("Your reading workspace changed.");
  return { page, loop: page.loops.find((loop) => loop.id === result.request.loopId)! };
}
