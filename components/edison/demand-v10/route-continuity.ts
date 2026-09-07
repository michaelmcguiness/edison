import { z } from "zod";
import { demandHistoryCursorSchema, uuidSchema, type DemandArticle, type DemandArticleResult, type DemandIdea, type DemandIdeaResult, type DemandLoop, type DemandWorkspace } from "@edison/contracts";

const originSchema = z.object({
  view: z.enum(["home", "loop", "library"]),
  loopId: uuidSchema.nullable(),
  ideaId: uuidSchema.nullable(),
  scrollY: z.number().finite().min(0).max(10_000_000),
  history: z.object({ scope: z.enum(["all", "saved"]), loopId: uuidSchema.optional(), cursor: demandHistoryCursorSchema.nullable() }).strict().optional(),
}).strict().refine((origin) => (origin.view === "loop" ? origin.loopId !== null : origin.loopId === null) &&
  (!origin.history || origin.history.scope === (origin.view === "library" ? "saved" : "all") &&
    (origin.history.loopId ?? null) === (origin.view === "loop" ? origin.loopId : null)));

export const demandNavigationSchema = z.object({
  version: z.literal(1), workspaceId: uuidSchema,
  selection: z.object({ kind: z.enum(["article", "idea"]), id: uuidSchema }).strict().nullable(),
  origin: originSchema,
}).strict();
export type DemandNavigation = z.infer<typeof demandNavigationSchema>;
export type DemandOrigin = DemandNavigation["origin"];
export type DemandRouteSelection = NonNullable<DemandNavigation["selection"]>;

export function parseDemandNavigation(value: unknown, workspaceId: string): DemandNavigation | null {
  const parsed = demandNavigationSchema.safeParse(value);
  return parsed.success && parsed.data.workspaceId === workspaceId ? parsed.data : null;
}

export function parseDemandRoute(pathname: string, search = ""): DemandRouteSelection | null {
  const article = pathname.match(/^\/articles\/([^/]+)\/?$/)?.[1];
  if (article && uuidSchema.safeParse(article).success) return { kind: "article", id: article };
  if (pathname !== "/" && pathname !== "/demand") return null;
  const ideas = new URLSearchParams(search).getAll("idea");
  return ideas.length === 1 && uuidSchema.safeParse(ideas[0]).success ? { kind: "idea", id: ideas[0]! } : null;
}

export function demandRouteHref(selection: DemandRouteSelection) {
  const id = uuidSchema.parse(selection.id);
  return selection.kind === "article" ? `/articles/${id}` : `/?idea=${id}`;
}

export function navigationForSelection(workspaceId: string, origin: DemandOrigin, selection: DemandRouteSelection | null): DemandNavigation {
  return demandNavigationSchema.parse({ version: 1, workspaceId, origin, selection });
}

export function availableDemandOrigin(origin: DemandOrigin, workspace: DemandWorkspace): DemandOrigin {
  return origin.view === "loop" && !workspace.loops.some(({ id, archivedAt }) => id === origin.loopId && !archivedAt)
    ? { view: "home", loopId: null, ideaId: null, scrollY: 0 } : origin;
}

/** Reload and browser navigation are reads, including an unconfirmed selection. */
export async function readDemandRouteSelection(input: {
  selection: DemandRouteSelection; workspaceId: string;
  getArticle: (id: string) => Promise<DemandArticleResult>;
  getIdea: (id: string) => Promise<DemandIdeaResult>;
}): Promise<DemandIdeaResult & { article: DemandArticle | null; loop: DemandLoop | null }> {
  const { selection } = input;
  if (selection.kind === "article") {
    const result = await input.getArticle(selection.id);
    if (result.workspaceId !== input.workspaceId || result.article.id !== selection.id) throw new Error("This article belongs to a different reading workspace.");
    return result;
  }
  const result = await input.getIdea(selection.id);
  if (result.workspaceId !== input.workspaceId || result.idea.id !== selection.id) throw new Error("This article belongs to a different reading workspace.");
  return { ...result, article: null, loop: null };
}

/** The origin card is the entry point, not necessarily the currently selected Next article. */
export async function resolveDemandOrigin(input: {
  navigation: DemandNavigation | null;
  workspace: DemandWorkspace;
  selectedIdea: DemandIdea;
  getIdea: (id: string) => Promise<DemandIdeaResult>;
}): Promise<{ origin: DemandOrigin & { ideaId: string }; recovered: DemandIdeaResult | null }> {
  const { workspace, selectedIdea } = input;
  const currentLoop = workspace.loops.find(({ id, archivedAt }) => id === selectedIdea.loopId && !archivedAt);
  const fallback = { view: currentLoop ? "loop" as const : "home" as const, loopId: currentLoop?.id ?? null, ideaId: selectedIdea.id, scrollY: 0 };
  const record = input.navigation && parseDemandNavigation(input.navigation, workspace.workspaceId);
  if (!record || !record.origin.ideaId) return { origin: fallback, recovered: null };
  const origin = record.origin as DemandOrigin & { ideaId: string };
  if (origin.view === "loop" && !workspace.loops.some(({ id, archivedAt }) => id === origin.loopId && !archivedAt)) {
    return { origin: { view: "home", loopId: null, ideaId: selectedIdea.id, scrollY: 0 }, recovered: null };
  }
  let recovered: DemandIdeaResult | null = null;
  let idea = origin.ideaId === selectedIdea.id ? selectedIdea : workspace.ideas.find(({ id }) => id === origin.ideaId);
  if (!idea) {
    try { recovered = await input.getIdea(origin.ideaId); }
    catch { return { origin: fallback, recovered: null }; }
    if (recovered.workspaceId !== workspace.workspaceId || recovered.idea.id !== origin.ideaId) return { origin: fallback, recovered: null };
    idea = recovered.idea;
  }
  if (origin.view === "loop" && idea.loopId !== origin.loopId) return { origin: fallback, recovered: null };
  return { origin, recovered };
}

/** Pending URL becomes the same history entry's stable ready URL, not a second entry. */
export function readyRouteHistoryMode(current: DemandRouteSelection | null, ideaId: string, articleId: string) {
  if (current?.kind === "article" && current.id === articleId) return "none" as const;
  return current?.kind === "idea" && current.id === ideaId ? "replace" as const : "push" as const;
}
