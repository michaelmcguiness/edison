"use client";

import { useState } from "react";
import type { Article, ArticleCard, ConversationMessage } from "@edison/contracts";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ArrowRight,
  MessageCircle,
  Link2Off,
  LoaderCircle,
  Share2,
} from "lucide-react";
import { EdisonMark } from "@/components/edison/brand";
import { edisonApi } from "@/lib/api-client";

type DataMode = "prototype" | "guest" | "public" | "live";

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
  conversationMessages,
  conversationLoading = false,
  conversationError,
  dataMode,
  back,
  save,
  onError,
  onCompleted,
  onShared,
  backLabel = "Back to edition",
  nextArticle,
  onNext,
  onAsk,
  deviceSave = false,
  pulse = false,
}: {
  article: Article;
  conversationMessages: ConversationMessage[];
  conversationLoading?: boolean;
  conversationError?: string;
  dataMode: DataMode;
  back: () => void;
  save: () => void;
  onError: (error: unknown) => void;
  onCompleted: (currentStreak: number) => void;
  onShared: (shareId: string | null) => void;
  backLabel?: string;
  nextArticle?: ArticleCard | null;
  onNext?: () => void;
  onAsk?: () => void;
  deviceSave?: boolean;
  pulse?: boolean;
}) {
  const [worth, setWorth] = useState<boolean | null>(null);
  const [completed, setCompleted] = useState(article.completed);
  const [busy, setBusy] = useState(false);
  const sourceById = new Map(article.sources.map((source) => [source.id, source]));
  const publicStarter = dataMode === "guest" || dataMode === "public";

  async function feedback(value: boolean) {
    if (publicStarter) return;
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
    if (completed || busy || publicStarter) return;
    if (dataMode === "prototype") {
      setCompleted(true);
      onCompleted(0);
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
    if (dataMode === "prototype" || busy) return;
    setBusy(true);
    let newlyCreatedShare = false;
    try {
      // Public links share only article identity, never a private loop or draft.
      let url = `${window.location.origin}/?view=article&article=${encodeURIComponent(article.id)}`;
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
    <main className={`article-reader${pulse ? " pulse-article-reader" : ""}`}>
      <div className="article-toolbar">
        <button onClick={back}>
          <ChevronLeft />{backLabel}
        </button>
        <div>
          <button
            onClick={save}
            aria-label={deviceSave ? article.saved ? "Remove from this device’s saved reading" : "Save on this device" : dataMode === "guest"
              ? "Sign in to save this story"
              : dataMode === "public"
                ? "Public starter stories cannot be saved to your private library"
                : article.saved ? "Remove from library" : "Save to library"}
            aria-pressed={publicStarter && !deviceSave ? undefined : article.saved}
            disabled={publicStarter && !deviceSave}
            title={dataMode === "guest"
              ? "Sign in to save stories"
              : dataMode === "public"
                ? "Public starter stories are separate from your private library"
                : undefined}
          >
            <Bookmark fill={article.saved ? "currentColor" : "none"} />
          </button>
          {onAsk && <button type="button" onClick={onAsk} aria-label="Ask about this article"><MessageCircle aria-hidden="true" /><span>Ask</span></button>}
          <button
            onClick={() => void share()}
            aria-label={publicStarter ? "Share public article" : dataMode === "live" ? "Share article" : "Article sharing is unavailable in this demo"}
            title={dataMode === "prototype" ? "Article sharing is unavailable in this demo" : undefined}
            disabled={dataMode === "prototype" || busy}
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
            <b>{dataMode === "prototype"
              ? "Sample article · Edison demo"
              : publicStarter
                ? "Written by Edison · Public starter edition"
                : `Written by Edison for ${article.writtenFor}`}</b>
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
        {article.correction && <aside className="article-correction" aria-label="Editorial correction">
          <b>Editorial correction · <time dateTime={article.correction.correctedAt}>{new Date(article.correction.correctedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></b>
          <p>{article.correction.note}</p>
        </aside>}
      </header>

      <aside className="why">
        <EdisonMark className="why-mark" />
        <div>
          <b>{dataMode === "prototype" ? "Example personalization" : publicStarter ? "Why this story was selected" : "Why Edison wrote this"}</b>
          <p>{article.reason}</p>
        </div>
      </aside>

      <div className="article-body">
        {article.body.map((block, index) => {
          if (block.type === "heading") {
            return <h2 id={`article-block-${index}`} data-reader-block key={`${block.text}-${index}`}>{block.text}</h2>;
          }
          if (block.type === "quote") {
            return (
              <blockquote id={`article-block-${index}`} data-reader-block key={`${block.text}-${index}`}>
                {block.text}
                {block.attribution && <cite>— {block.attribution}</cite>}
                <Citations citations={block.citations} sources={sourceById} />
              </blockquote>
            );
          }
          return (
            <p id={`article-block-${index}`} data-reader-block key={`${block.text}-${index}`}>
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

      {pulse && <nav className="pulse-reading-next" aria-label="Continue reading">
        {nextArticle && onNext ? <>
          <p>Next article</p>
          <button type="button" className="pulse-next-article" onClick={() => { void complete(); onNext(); }}><span>{nextArticle.title}</span><ArrowRight aria-hidden="true" /></button>
          <button type="button" className="pulse-back-to-feed" onClick={() => { void complete(); back(); }}>{backLabel}</button>
        </> : <button type="button" className="pulse-next-article" onClick={() => { void complete(); back(); }}>{backLabel}<ArrowRight aria-hidden="true" /></button>}
      </nav>}

      {!pulse && (conversationLoading || conversationError || conversationMessages.length > 0) && (
        <section className="conversation-answer" aria-live="polite">
          <span className="eyebrow">Article conversation</span>
          <h2>Your follow-ups</h2>
          {conversationLoading && !conversationMessages.length && (
            <p className="conversation-state">Opening your conversation…</p>
          )}
          {conversationError && (
            <p className="editorial-error" role="alert">{conversationError}</p>
          )}
          {conversationMessages.map((message) => (
            <div className={`conversation-message ${message.role}`} key={message.id}>
              <b>{message.role === "user" ? "You" : "Edison"}</b>
              <p>
                {message.content}
                {message.role === "assistant" && (
                  <Citations citations={message.citations} sources={sourceById} />
                )}
              </p>
            </div>
          ))}
        </section>
      )}

      {(!pulse || !publicStarter) && <section className="worth">
        <h2>Was this worth your time?</h2>
        {dataMode === "guest" ? (
          <p><a href="/login">Sign in</a> to save feedback and shape future editions. Reading remains open without an account.</p>
        ) : dataMode === "public" ? (
          <p>Feedback on public starter stories is separate from your private publication. Open a personal-edition story to shape future editions.</p>
        ) : worth === null ? (
          <div>
            <button onClick={() => void feedback(true)}>Yes</button>
            <button onClick={() => void feedback(false)}>Not quite</button>
          </div>
        ) : (
          <p><Check />{dataMode === "prototype"
            ? "Demo feedback only. This response is not stored or used for personalization."
            : "Thanks. This will shape what Edison writes next."}</p>
        )}
      </section>}

      {!pulse && <button
        className={`complete ${completed ? "is-complete" : ""}`}
        onClick={() => void complete()}
        disabled={completed || busy || publicStarter}
        title={dataMode === "guest"
          ? "Sign in to save reading progress"
          : dataMode === "public"
            ? "Reading progress is tracked on personal-edition stories"
            : undefined}
      >
        {busy ? <LoaderCircle className="spin" /> : <Check />}
        {completed
          ? "Read"
          : dataMode === "guest"
            ? "Sign in to track reading"
            : dataMode === "public"
              ? "Available in your personal edition"
              : "Mark as read"}
      </button>}
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
