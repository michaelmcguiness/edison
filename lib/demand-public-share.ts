import { demandShareTokenSchema, publicDemandArticleShareSchema, type PublicDemandArticleShare } from "@edison/contracts";

/** Shared snapshot access is member-only. Never forward browser cookies. */
export async function fetchDemandPublicShare(token: string, options: {
  apiUrl?: string; production?: boolean; fetcher?: typeof fetch; accessToken?: string;
}): Promise<PublicDemandArticleShare | null> {
  if (!demandShareTokenSchema.safeParse(token).success) return null;
  if (!options.accessToken) throw new Error("Invited sign-in is required to read shared articles.");
  let base: URL;
  try {
    base = new URL(options.apiUrl ?? "");
    const local = !options.production && ["127.0.0.1", "localhost"].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || base.pathname.replace(/\/$/, "") !== "/v1" ||
        (base.protocol !== "https:" && !(local && base.protocol === "http:"))) return null;
  } catch { return null; }
  const response = await (options.fetcher ?? fetch)(`${base.href.replace(/\/$/, "")}/public/demand-shares/${token}`, {
    cache: "no-store", redirect: "error", credentials: "omit", headers: { Authorization: `Bearer ${options.accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("The shared article is temporarily unavailable.");
  // Validate the entire public response before either rendering or metadata.
  const share = publicDemandArticleShareSchema.parse(await response.json());
  if (share.token !== token) throw new Error("The public article identity did not match.");
  return share;
}

export function demandPublicShareMetadata(share: PublicDemandArticleShare) {
  const url = `https://edisonreader.com/s/demand/${share.token}`;
  return { title: `${share.article.title} — Edison`, description: share.article.deck,
    robots: { index: false, follow: false }, referrer: "no-referrer" as const,
    alternates: { canonical: url },
    openGraph: { type: "article" as const, title: share.article.title, description: share.article.deck, url, siteName: "Edison" },
    twitter: { card: "summary" as const, title: share.article.title, description: share.article.deck } };
}
