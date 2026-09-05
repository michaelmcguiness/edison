import { z } from "zod";
import { articleCardSchema } from "@edison/contracts";

const historySchema = z.object({
  id: z.string().uuid(),
  direction: z.string().max(1000),
  previousDirection: z.string().max(1000),
  createdAt: z.string().datetime(),
});

export const localLoopSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  originalCuriosity: z.string().trim().min(1).max(500),
  direction: z.string().max(1000),
  revision: z.number().int().nonnegative(),
  paused: z.boolean(),
  articleIds: z.array(z.string().uuid()).max(30),
  publicArticleIds: z.array(z.string().uuid()).max(30),
  lastMutationId: z.string().uuid().nullable(),
  history: z.array(historySchema).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LocalLoop = z.infer<typeof localLoopSchema>;

export const pulseWorkspaceSchema = z.object({
  version: z.literal(1),
  loops: z.array(localLoopSchema).max(20),
  savedPublicArticles: z.array(articleCardSchema).max(30),
  newLoopDraft: z.string().max(500),
  directionDrafts: z.record(z.string().uuid(), z.string().max(1000)).refine((items) => Object.keys(items).length <= 30),
}).strict();
export type PulseWorkspace = z.infer<typeof pulseWorkspaceSchema>;
export const emptyPulseWorkspace = (): PulseWorkspace => ({ version: 1, loops: [], savedPublicArticles: [], newLoopDraft: "", directionDrafts: {} });

export function pulseWorkspaceKey(identity?: string | null): string {
  return `edison:pulse:v1:${identity ? `account:${encodeURIComponent(identity)}` : "guest"}`;
}

export function parsePulseWorkspace(raw: string | null): PulseWorkspace {
  if (!raw) return emptyPulseWorkspace();
  // Do not silently overwrite an unsupported/corrupt local record.
  return pulseWorkspaceSchema.parse(JSON.parse(raw));
}

export function createLocalLoop(workspace: PulseWorkspace, input: {
  title: string; originalCuriosity: string; publicArticleIds: string[];
}, id: string, now: string): { workspace: PulseWorkspace; loop: LocalLoop } {
  const normalized = input.title.trim().toLocaleLowerCase("en-US");
  const existing = workspace.loops.find((loop) => loop.title.trim().toLocaleLowerCase("en-US") === normalized);
  if (existing) return { workspace, loop: existing };
  if (workspace.loops.length >= 20) throw new Error("You can keep up to 20 loops on this device.");
  const loop = localLoopSchema.parse({ ...input, id, title: input.title.trim(), direction: "", revision: 0, paused: false, articleIds: [], lastMutationId: null, history: [], createdAt: now, updatedAt: now });
  return { workspace: { ...workspace, loops: [...workspace.loops, loop] }, loop };
}

export function changeLocalDirection(workspace: PulseWorkspace, loopId: string, baseRevision: number, direction: string, mutationId: string, now: string, undoId?: string): PulseWorkspace {
  const loop = workspace.loops.find((entry) => entry.id === loopId);
  if (!loop) throw new Error("That loop is no longer available.");
  if (loop.revision !== baseRevision) throw new Error("This loop changed in another tab. Review its current direction before trying again.");
  const previous = loop.history.find((entry) => entry.id === undoId);
  if (undoId && (!previous || loop.lastMutationId !== undoId)) throw new Error("Only the latest direction change can be undone.");
  const nextDirection = undoId ? previous!.previousDirection : direction.trim();
  const next = localLoopSchema.parse({
    ...loop,
    direction: nextDirection,
    revision: loop.revision + 1,
    lastMutationId: undoId ? null : mutationId,
    updatedAt: now,
    history: [{ id: mutationId, previousDirection: loop.direction, direction: nextDirection, createdAt: now }, ...loop.history].slice(0, 20),
  });
  return { ...workspace, loops: workspace.loops.map((entry) => entry.id === loopId ? next : entry) };
}
