import { z } from "zod";
import { uuidSchema } from "./common";
import { demandHistoryCursorSchema, demandIdeaSchema, demandLoopSchema, demandRequestSchema } from "./demand";

export const DEMAND_LOOP_PAGE_SIZE = 30;
export const demandLoopsQuerySchema = z.object({ cursor: demandHistoryCursorSchema.optional() }).strict();
export function parseDemandLoopsQuery(params: URLSearchParams) {
  if ([...params.keys()].some((key) => key !== "cursor") || params.getAll("cursor").length > 1) {
    throw new Error("invalid_loop_query");
  }
  return demandLoopsQuerySchema.parse(params.has("cursor") ? { cursor: params.get("cursor") } : {});
}
export const demandLoopsSchema = z.object({
  workspaceId: uuidSchema,
  loops: z.array(demandLoopSchema).max(DEMAND_LOOP_PAGE_SIZE),
  ideas: z.array(demandIdeaSchema).max(DEMAND_LOOP_PAGE_SIZE * 6),
  // Six possible bodies plus the current and newest pending/failed batch per
  // loop: bounded without dropping current-card status from an older loop.
  requests: z.array(demandRequestSchema).max(DEMAND_LOOP_PAGE_SIZE * 8),
  nextCursor: demandHistoryCursorSchema.nullable(),
}).strict().refine((page) => new Set(page.loops.map((loop) => loop.id)).size === page.loops.length &&
  new Set(page.ideas.map((idea) => idea.id)).size === page.ideas.length &&
  new Set(page.requests.map((request) => request.id)).size === page.requests.length &&
  page.ideas.every((idea) => page.loops.some((loop) => loop.id === idea.loopId)) &&
  page.requests.every((request) => page.loops.some((loop) => loop.id === request.loopId)),
"Loop pages must retain unique identities and local loop context.");
export type DemandLoopsQuery = z.infer<typeof demandLoopsQuerySchema>;
export type DemandLoops = z.infer<typeof demandLoopsSchema>;
