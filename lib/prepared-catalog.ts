import type { ArticleCard } from "@edison/contracts";

export type PreparedSubject = {
  title: string;
  aliases: readonly string[];
  articleIds: readonly string[];
  artwork: { src: string; alt: string; captionColor: string };
};

/** Publication-response IDs only. Populated after reviewed, real ingestion. */
export const preparedSubjects: readonly PreparedSubject[] = [];

export function matchPreparedSubject(curiosity: string, available: readonly ArticleCard[]): PreparedSubject | null {
  const normalized = curiosity.trim().toLocaleLowerCase("en-US").replace(/[?!.]+$/, "");
  const ids = new Set(available.map((article) => article.id));
  return preparedSubjects.find((subject) =>
    subject.aliases.includes(normalized) && subject.articleIds.some((id) => ids.has(id)),
  ) ?? null;
}

export function preparedSuggestions(available: readonly ArticleCard[]): string[] {
  const ids = new Set(available.map((article) => article.id));
  return preparedSubjects.filter((subject) => subject.articleIds.some((id) => ids.has(id))).map((subject) => subject.title);
}

export const preparedArtworkByArticleId = Object.fromEntries(preparedSubjects.flatMap((subject) =>
  subject.articleIds.map((id) => [id, subject.artwork]),
));
