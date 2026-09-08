"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import type { ArticleCard } from "@edison/contracts";
import { ArrowRight, Bookmark } from "lucide-react";

export interface PulseArtwork {
  src: string;
  alt: string;
  captionColor: string;
  width?: number;
  height?: number;
}

export const PULSE_SLEEP_ARTWORK: PulseArtwork = {
  src: "/brand/pulse-loops/sleep-attention.png",
  alt: "A pillow and peach blanket beside a moonlit window.",
  captionColor: "#435a68",
  width: 1254,
  height: 1254,
};

export const PULSE_LONGITUDE_ARTWORK: PulseArtwork = {
  src: "/brand/pulse-loops/longitude.png",
  alt: "A sailboat and an abstract marine clock.",
  captionColor: "#375d68",
  width: 1254,
  height: 1254,
};

export interface PulseFeedProps {
  articles: readonly ArticleCard[];
  intro: string;
  activeLoopLabel?: string;
  artworkByArticleId?: Readonly<Record<string, PulseArtwork | undefined>>;
  heading?: string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string;
  errorTitle?: string;
  emptyState?: ReactNode;
  children?: ReactNode;
  savingArticleId?: string | null;
  onOpenArticle: (article: ArticleCard) => void | Promise<void>;
  onToggleSave?: (article: ArticleCard) => void | Promise<void>;
}

function ArticleMeta({ article }: { article: ArticleCard }) {
  return (
    <p className="pulse-card-meta">
      <span>{article.kicker}</span>
      <span aria-hidden="true"> · </span>
      <span>{article.readingMinutes} min</span>
      <span aria-hidden="true"> · </span>
      <span>
        {article.sourceCount} {article.sourceCount === 1 ? "source" : "sources"}
      </span>
    </p>
  );
}

function PulseArticleCard({
  article,
  artwork,
  saving,
  onOpenArticle,
  onToggleSave,
}: {
  article: ArticleCard;
  artwork?: PulseArtwork;
  saving: boolean;
  onOpenArticle: PulseFeedProps["onOpenArticle"];
  onToggleSave?: PulseFeedProps["onToggleSave"];
}) {
  const titleId = useId();
  const style = {
    "--pulse-card-caption": artwork?.captionColor ?? "#343638",
  } as CSSProperties;

  return (
    <article
      className="pulse-card pulse-card--without-art"
      style={style}
      data-article-id={article.id}
    >
      <button
        type="button"
        className="pulse-card-open-target"
        aria-labelledby={titleId}
        onClick={() => void onOpenArticle(article)}
      />

      <div className="pulse-card-copy">
        <ArticleMeta article={article} />
        <h2 id={titleId}>{article.title}</h2>
        <p className="pulse-card-deck">{article.deck}</p>
        <div className="pulse-card-footer">
          <span className="pulse-card-open" aria-hidden="true">
            <span>Read article</span>
            <ArrowRight aria-hidden="true" />
          </span>

          {onToggleSave ? (
            <button
              type="button"
              className="pulse-card-save"
              aria-label={article.saved ? `Remove from Library: ${article.title}` : `Save to Library: ${article.title}`}
              aria-pressed={article.saved}
              disabled={saving}
              onClick={() => void onToggleSave(article)}
            >
              <Bookmark aria-hidden="true" fill={article.saved ? "currentColor" : "none"} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function PulseFeed({
  articles,
  intro,
  activeLoopLabel = "this loop",
  artworkByArticleId = {},
  heading = "Today",
  loading = false,
  loadingLabel = "Loading your reading…",
  error = "",
  errorTitle = "We couldn’t load your reading.",
  emptyState,
  children,
  savingArticleId = null,
  onOpenArticle,
  onToggleSave,
}: PulseFeedProps) {
  const headingId = useId();
  const hasArticles = articles.length > 0;

  return (
    <main className="pulse-feed" aria-labelledby={headingId} aria-busy={loading}>
      <div className="pulse-feed-heading">
        <h1 id={headingId}>{heading}</h1>
      </div>
      <p className="pulse-feed-intro">{intro}</p>

      {loading && !hasArticles ? (
        <div className="pulse-feed-state" role="status">
          <p>{loadingLabel}</p>
        </div>
      ) : null}

      {error ? (
        <div className="pulse-feed-state pulse-feed-state--error" role={hasArticles ? "status" : "alert"}>
          <h2>{errorTitle}</h2>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && !error && !hasArticles ? (
        <div className="pulse-feed-state pulse-feed-state--empty">
          {emptyState ?? (
            <>
              <h2>No articles are ready in {activeLoopLabel}.</h2>
              <p>Try another loop or come back when a new read is ready.</p>
            </>
          )}
        </div>
      ) : null}

      {hasArticles ? (
        <div className="pulse-card-grid">
          {articles.map((article) => (
            <PulseArticleCard
              key={article.id}
              article={article}
              artwork={artworkByArticleId[article.id]}
              saving={savingArticleId === article.id}
              onOpenArticle={onOpenArticle}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      ) : null}

      {children}

      {hasArticles && !loading && !error ? (
        <div className="pulse-feed-ending">
          <h2>That’s all for now.</h2>
        </div>
      ) : null}
    </main>
  );
}
