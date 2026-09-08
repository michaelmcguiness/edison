import { z } from "zod";
import { uuidSchema, demandShareTokenSchema, shareSlugSchema } from "@edison/contracts";

const continuationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_loop"), curiosity: z.string().max(500).optional() }).strict(),
  z.object({ kind: z.literal("refresh"), loopId: uuidSchema }).strict(),
]);
export type DemandAccountIntent = z.infer<typeof continuationSchema>;
const lifetime = 30 * 60 * 1000;
const prefix = "edison:account-continuation:";
const storedSchema = z.object({ intent: continuationSchema, createdAt: z.number().int().nonnegative() }).strict();
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The return URL contains only a random operation identity, never a curiosity,
 * token or arbitrary redirect target. No action is executed by this helper. */
export function saveDemandAccountContinuation(input: {
  intent: DemandAccountIntent; id: string; storage: StorageAccess; now?: number;
}) {
  const id = uuidSchema.parse(input.id);
  const intent = continuationSchema.parse(input.intent);
  input.storage.setItem(`${prefix}${id}`, JSON.stringify({ intent, createdAt: input.now ?? Date.now() }));
  return `/?continue=${id}`;
}

export function safeDemandAuthReturnPath(value: unknown) {
  if (typeof value !== "string") return "/";
  if (value === "/" || value === "/demand") return value;
  // Exact reading destinations only; no arbitrary same-origin/open redirect.
  const article = /^\/articles\/([^/?#]+)$/.exec(value);
  if (article && uuidSchema.safeParse(article[1]).success) return value;
  const share = /^\/s\/demand\/([^/?#]+)$/.exec(value);
  if (share && demandShareTokenSchema.safeParse(share[1]).success) return value;
  const legacyShare = /^\/share\/([^/?#]+)$/.exec(value);
  if (legacyShare && shareSlugSchema.safeParse(legacyShare[1]).success) return value;
  const idea = /^\/\?idea=([^&?#]+)$/.exec(value);
  if (idea && uuidSchema.safeParse(idea[1]).success) return value;
  const match = /^\/\?continue=([^&?#]+)$/.exec(value);
  return match && uuidSchema.safeParse(match[1]).success ? `/?continue=${match[1]}` : "/";
}

export function takeDemandAccountContinuation(input: {
  returnPath: string; storage: StorageAccess; now?: number;
}): DemandAccountIntent | null {
  const path = safeDemandAuthReturnPath(input.returnPath);
  if (!path.startsWith("/?continue=")) return null;
  const key = `${prefix}${path.slice("/?continue=".length)}`;
  try {
    const raw = input.storage.getItem(key);
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    // Consume only this attempt, not another tab's new-loop draft.
    input.storage.removeItem(key);
    if (!parsed.success) return null;
    const age = (input.now ?? Date.now()) - parsed.data.createdAt;
    return age >= 0 && age <= lifetime ? parsed.data.intent : null;
  } catch { return null; }
}

export function demandLoginPath(returnPath: unknown, error?: string, invitationId?: string) {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (invitationId && uuidSchema.safeParse(invitationId).success) params.set("invitation", invitationId);
  const next = safeDemandAuthReturnPath(returnPath);
  if (next !== "/") params.set("next", next);
  return `/login${params.size ? `?${params}` : ""}`;
}
