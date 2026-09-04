"use client";

import { useState } from "react";
import type { Article } from "@edison/contracts";
import {
  Bookmark,
  Check,
  ChevronLeft,
  Link2Off,
  LoaderCircle,
  Share2,
} from "lucide-react";
import { EdisonMark } from "@/components/edison/brand";
import { edisonApi } from "@/lib/api-client";

type DataMode = "prototype" | "live";

function researchedLabel(iso: string) {
  const researched = new Date(iso);
  return researched.toDateString() === new Date().toDateString()
    ? "Researched today"
    : `Researched ${researched.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`;
}

export function ArticleView({
  article,
  conversationAnswer,
  dataMode,
  back,
  save,
  onError,
  onCompleted,
  onShared,
}: {
  article: Article;
  conversationAnswer: {
    answer: string;
    citations: Array<{ sourceId: string; label: string }>;
  } | null;
  dataMode: DataMode;
  back: () => void;
  save: () => void;
  onError: (error: unknown) => void;
  onCompleted: (currentStreak: number) => void;
  onShared: (shareId: string | null) => void;
}) {
  const [worth, setWorth] = useState<boolean | null>(null);
  const [completed, setCompleted] = useState(article.completed);
  const [busy, setBusy] = useState(false);
  const sourceById = new Map(article.sources.map((source) => [source.id, source]));

  async function feedback(value: boolean) {
    setWorth(value);
    if (dataMode === "prototype") return;
    try {
      await edisonApi(`/articles/${article.id}/feedback`, {
        method: "PUT",
        body: JSON.stringify({ worthYourTime: value }),
      });
    } catch (error) {
      setWorth(null);
      onError(error);
    }
  }

  async function complete() {
    if (completed || busy) return;
    if (dataMode === "prototype") {
      setCompleted(true);
      onCompleted(12);
      return;
    }
    setBusy(true);
    try {
      const response = await edisonApi<{ currentStreak: number }>(
        `/articles/${article.id}/events`,
        {
          method: "POST",
          body: JSON.stringify({
            eventType: "completed",
            progressPercent: 100,
            idempotencyKey: `complete-${crypto.randomUUID()}`,
          }),
        },
      );
      setCompleted(true);
      onCompleted(response.currentStreak);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (dataMode !== "live" || busy) return;
    setBusy(true);
    let newlyCreatedShare = false;
    try {
      let url = window.location.href;
      if (dataMode === "live") {
        const response = await edisonApi<{
          shareId: string;
          url: string;
          created: boolean;
        }>(
          `/articles/${article.id}/share`,
          { method: "POST" },
        );
        url = response.url;
        newlyCreatedShare = response.created;
        onShared(response.shareId);
      }

      if (navigator.share) {
        await navigator.share({ title: article.title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }

      if (dataMode === "live") {
        void edisonApi(`/articles/${article.id}/events`, {
          method: "POST",
          body: JSON.stringify({
            eventType: "shared",
            idempotencyKey: `share-${crypto.randomUUID()}`,
          }),
        }).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (dataMode === "live" && newlyCreatedShare) {
          try {
            await edisonApi(`/articles/${article.id}/share`, {
              method: "DELETE",
            });
            onShared(null);
          } catch (cleanupError) {
            onError(cleanupError);
          }
        }
        return;
      }
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function revokeShare() {
    if (dataMode !== "live" || busy || !article.shareId) return;
    setBusy(true);
    try {
      if (dataMode === "live") {
        await edisonApi(`/articles/${article.id}/share`, { method: "DELETE" });
      }
      onShared(null);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="article-reader">
      <div className="article-toolbar">
        <button onClick={back}>
          <ChevronLeft />Today
        </button>
        <div>
          <button
            onClick={save}
            aria-label={article.saved ? "Remove from library" : "Save to library"}
            aria-pressed={article.saved}
          >
            <Bookmark fill={article.saved ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => void share()}
            aria-label={dataMode === "prototype" ? "Article sharing is unavailable in this demo" : "Share article"}
            title={dataMode === "prototype" ? "Article sharing is unavailable in this demo" : undefined}
            disabled={dataMode !== "live" || busy}
          >
            {busy ? <LoaderCircle className="spin" /> : <Share2 />}
          </button>
          {article.shareId ? (
            <button
              onClick={() => void revokeShare()}
              aria-label="Revoke public share link"
              disabled={busy}
            >
              <Link2Off />
            </button>
          ) : null}
        </div>
      </div>

      <header className="article-head">
        <span className="kicker">{article.kicker}</span>
        <h1>{article.title}</h1>
        <p>{article.deck}</p>
        <div className="byline">
          <EdisonMark className="small" />
          <span>
            <b>{dataMode === "prototype" ? "Sample article · Edison demo" : `Written by Edison for ${article.writtenFor}`}</b>
            <small>
              {dataMode === "prototype" ? "Illustrative text · not a researched publication" : (
                <>
                  {article.readingMinutes} min · {article.sourceCount} sources ·{" "}
                  <time dateTime={article.researchedAt}>
                    {researchedLabel(article.researchedAt)}
                  </time>
                </>
              )}
            </small>
          </span>
        </div>
      </header>

      <aside className="why">
        <EdisonMark className="why-mark" />
        <div>
          <b>{dataMode === "prototype" ? "Example personalization" : "Why Edison wrote this"}</b>
          <p>{article.reason}</p>
        </div>
      </aside>

      <div className="article-body">
        {article.body.map((block, index) => {
          if (block.type === "heading") {
            return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
          }
          if (block.type === "quote") {
            return (
              <blockquote key={`${block.text}-${index}`}>
                {block.text}
                {block.attribution && <cite>— {block.attribution}</cite>}
                <Citations citations={block.citations} sources={sourceById} />
              </blockquote>
            );
          }
          return (
            <p key={`${block.text}-${index}`}>
              {block.text}
              <Citations citations={block.citations} sources={sourceById} />
            </p>
          );
        })}
      </div>

      <section className="sources">
        <h2>{dataMode === "prototype" ? "Sources preview" : "Sources"}</h2>
        {dataMode === "prototype" && (
          <p>This sample text has not been researched or verified. Live articles will include source links and claim-level citations.</p>
        )}
        <ol>
          {article.sources.map((source, index) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">
                <span>{index + 1}</span>
                <div>
                  <b>{source.publisher}</b>
                  <small>{source.title}</small>
                </div>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {conversationAnswer && (
        <section className="conversation-answer" aria-live="polite">
          <span className="eyebrow">Your follow-up</span>
          <h2>Edison&apos;s answer</h2>
          <p>
            {conversationAnswer.answer}
            <Citations
              citations={conversationAnswer.citations}
              sources={sourceById}
            />
          </p>
        </section>
      )}

      <section className="worth">
        <h2>Was this worth your time?</h2>
        {worth === null ? (
          <div>
            <button onClick={() => void feedback(true)}>Yes</button>
            <button onClick={() => void feedback(false)}>Not quite</button>
          </div>
        ) : (
          <p><Check />{dataMode === "prototype"
            ? "Demo feedback only. This response is not stored or used for personalization."
            : "Thanks. This will shape what Edison writes next."}</p>
        )}
      </section>

      <button
        className={`complete ${completed ? "is-complete" : ""}`}
        onClick={() => void complete()}
        disabled={completed || busy}
      >
        {busy ? <LoaderCircle className="spin" /> : <Check />}
        {completed ? "Read" : "Mark as read"}
      </button>
    </main>
  );
}

function Citations({
  citations,
  sources,
}: {
  citations: Array<{ sourceId: string; label: string }>;
  sources: Map<string, Article["sources"][number]>;
}) {
  if (!citations.length) return null;
  return (
    <sup>
      {citations.map((citation, index) => {
        const source = sources.get(citation.sourceId);
        return source ? (
          <a
            key={`${citation.sourceId}-${citation.label}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title={`${source.publisher}: ${source.title}`}
          >
            {index ? "," : ""}{citation.label}
          </a>
        ) : null;
      })}
    </sup>
  );
}
