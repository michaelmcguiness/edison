"use client";

import { useId, type ReactNode } from "react";
import { Bookmark, LoaderCircle, RefreshCw } from "lucide-react";
import { isDemandArtAvailable, type DemandIdea } from "@edison/contracts";
import { DemandArticleArt } from "./art";

export function ArticleCard({ idea, eyebrow, action, saving, onOpen, onSave }: {
  idea: DemandIdea; eyebrow?: string; action: string; saving: boolean;
  onOpen: () => void; onSave: () => void;
}) {
  const titleId = useId();
  return <article className="demand-idea-card demand-article-card" data-idea-id={idea.id}>
    <button type="button" className="demand-idea-open-target" aria-label={`${action}: ${idea.title}`} onClick={onOpen} />
    {isDemandArtAvailable(idea.art) ? <div className="demand-card-art"><DemandArticleArt descriptor={idea.art} /></div> : null}
    <div className="demand-idea-copy">
      {eyebrow ? <p className="demand-card-kicker">{eyebrow}</p> : null}
      <h2 id={titleId}>{idea.title}</h2><p>{idea.deck}</p>
      <div className="demand-idea-footer"><span className="demand-idea-action" aria-hidden="true">{action}</span>
        <button type="button" className="demand-save-action" aria-label={idea.saved ? `Remove saved article: ${idea.title}` : `Save article: ${idea.title}`}
          aria-pressed={idea.saved} disabled={saving} onClick={onSave}>
          {saving ? <LoaderCircle className="demand-spin" aria-hidden="true" /> : <Bookmark aria-hidden="true" fill={idea.saved ? "currentColor" : "none"} />}
        </button>
      </div>
    </div>
  </article>;
}

export function ArticleFeedToolbar({ balance, pending, disabled, count, onRefresh, onAllowance }: {
  balance: ReactNode; pending: boolean; disabled: boolean; count: number | null; onRefresh: () => void; onAllowance: () => void;
}) {
  return <div className="demand-feed-toolbar">
    <button type="button" className="demand-weekly-balance" onClick={onAllowance} aria-label="View weekly article allowance">{balance}</button>
    <button type="button" className="demand-refresh-articles" onClick={onRefresh} disabled={pending || disabled}>
      <RefreshCw aria-hidden="true" />{pending ? "Refreshing…" : count && count < 6 ? `Refresh ${count} ${count === 1 ? "article" : "articles"}` : "Refresh articles"}
    </button>
  </div>;
}
