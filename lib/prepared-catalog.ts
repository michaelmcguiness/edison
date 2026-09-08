import type { ArticleCard } from "@edison/contracts";
import published from "@/content/public-starters/published-sleep-history-v1.json";

export type PreparedSubject = {
  title: string;
  aliases: readonly string[];
  articleIds: readonly string[];
  artwork: { src: string; alt: string; captionColor: string };
};

/** Bound to the exact snapshots verified through the live public API. */
export const preparedSubjects: readonly PreparedSubject[] = [
  {
    title: "Sleep",
    aliases: ["sleep", "sleep and attention", "sleep deprivation", "sleep recovery"],
    articleIds: published.subjects.find((subject) => subject.id === "sleep")!.publicArticleIds,
    artwork: { src: "/brand/pulse-loops/sleep-attention.png", alt: "A pillow and peach blanket beside a moonlit window.", captionColor: "#435a68" },
  },
  {
    title: "History",
    aliases: ["history", "longitude", "history of longitude", "marine chronometers"],
    articleIds: published.subjects.find((subject) => subject.id === "history")!.publicArticleIds,
    artwork: { src: "/brand/pulse-loops/longitude.png", alt: "A sailboat and an abstract marine clock.", captionColor: "#375d68" },
  },
];

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
