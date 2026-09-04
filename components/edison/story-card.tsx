"use client";

import { useRef } from "react";
import type { ArticleCard } from "@edison/contracts";
import { Bookmark } from "lucide-react";

export const storyTones = ["blue", "rust", "mint", "gold"] as const;

const storyArtwork: Record<(typeof storyTones)[number], string> = {
  blue: "/brand/edison-source-assemblage.webp",
  rust: "/brand/edison-cities-assemblage.webp",
  mint: "/brand/edison-models-assemblage.webp",
  gold: "/brand/edison-attention-assemblage.webp",
};

function StoryArtwork({
  story,
  tone,
}: {
  story: ArticleCard;
  tone: (typeof storyTones)[number];
}) {
  return (
    <div
      className={`story-art ${tone}`}
      style={{ "--story-image": `url(${storyArtwork[tone]})` } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="story-art__image" />
      <span className="story-art__bracket" />
      <span className="story-art__folio">
        {String(story.readingMinutes).padStart(2, "0")} min
      </span>
    </div>
  );
}

function researchedLabel(iso: string) {
  const researched = new Date(iso);
  return researched.toDateString() === new Date().toDateString()
    ? "Researched today"
    : `Researched ${researched.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`;
}

export function StoryCard({
  story,
  dataMode = "live",
  lead = false,
  open,
  summary,
  save,
  timerRef,
  tone,
}: {
  story: ArticleCard;
  dataMode?: "prototype" | "live";
  lead?: boolean;
  open: (story: ArticleCard) => Promise<void>;
  summary: (story: ArticleCard) => void;
  save: (story: ArticleCard) => Promise<void>;
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  tone: (typeof storyTones)[number];
}) {
  const Title = lead ? "h1" : "h2";
  const summaryHintId = `story-summary-hint-${story.id}`;
  const longPressTriggered = useRef(false);
  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    longPressTriggered.current = false;
    timerRef.current = setTimeout(() => {
      longPressTriggered.current = true;
      summary(story);
    }, 500);
  };
  const cancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  return (
    <article className={`story-card story-tone-${tone} ${lead ? "lead" : ""}`}>
      <div className="story-main">
        <span className="kicker">{story.kicker}</span>
        <Title>{story.title}</Title>
        <p>{story.deck}</p>
        <div className="meta">
          {dataMode === "prototype" ? (
            <span>Sample story · illustrative content</span>
          ) : (
            <>
              <span>{story.readingMinutes} min</span>
              <span>{story.sourceCount} sources</span>
              <time dateTime={story.researchedAt}>
                {researchedLabel(story.researchedAt)}
              </time>
            </>
          )}
        </div>
        <small>{dataMode === "prototype" ? `Example: ${story.reason}` : story.reason}</small>
        <button
          className="story-action"
          aria-label={`Read ${story.title}`}
          aria-describedby={summaryHintId}
          aria-keyshortcuts="Shift+F10"
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerCancel={cancel}
          onPointerLeave={cancel}
          onContextMenu={(event) => {
            event.preventDefault();
            summary(story);
          }}
          onKeyDown={(event) => {
            if (
              (event.shiftKey && event.key === "F10") ||
              event.key === "ContextMenu"
            ) {
              event.preventDefault();
              summary(story);
            }
          }}
          onClick={(event) => {
            if (longPressTriggered.current) {
              event.preventDefault();
              longPressTriggered.current = false;
              return;
            }
            void open(story);
          }}
        >
          <span className="visually-hidden">Read {story.title}</span>
        </button>
        <span className="visually-hidden" id={summaryHintId}>
          Press Shift+F10 for a three-point summary.
        </span>
      </div>
      <StoryArtwork story={story} tone={tone} />
      <button
        className={`save ${story.saved ? "is-saved" : ""}`}
        onClick={() => void save(story)}
        aria-label={story.saved ? "Remove from library" : "Save to library"}
        aria-pressed={story.saved}
      >
        <Bookmark fill={story.saved ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
