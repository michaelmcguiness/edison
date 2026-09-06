"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import type {
  ArticleBlock,
  ArticleSource,
  DemandAnswer,
  DemandArticle,
  DemandIdea,
  DemandLoop,
  DemandRequest,
  DemandWorkspace,
  DemandIdeaResult,
} from "@edison/contracts";
import {
  ArrowRight,
  Bookmark,
  ChevronLeft,
  LoaderCircle,
  MessageCircle,
  X,
} from "lucide-react";
import { EdisonMark } from "@/components/edison/brand";
import { useEditorialDialogViewport } from "@/components/edison/editorial-composer";
import {
  PULSE_FOR_YOU_ID,
  PulseShell,
} from "@/components/edison/pulse-shell";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyDemandFeedback,
  askDemandQuestion,
  createDemandLoop,
  getDemandResult,
  getDemandWorkspace,
  getDemandHistory,
  getDemandIdea,
  requestDemandArticle,
  requestDemandIdeas,
  retryDemandRequest,
  startDemandSession,
  updateDemandIdeaEvent,
} from "@/lib/demand-client";
import {
  clearsSubmittedDemandFeedback, demandReadingPositionForIdea, DemandWorkspaceResponses,
  rememberDemandReadingPosition, restoreCurrentDemandContinuity, restoreDemandReadingPositions, restoredDemandArticlePosition,
  runScopedDemandRequest, type DemandContinuity, type DemandReadingPositions, type SubmittedDemandFeedback,
} from "@/lib/demand-reader-state";
import { demandHistoryRecords, demandHistoryScopeKey, DemandReaderHistory, type HistoryScope } from "@/lib/demand-reader-history";

export const browserDemandReaderClient = {
  applyDemandFeedback,
  askDemandQuestion,
  createDemandLoop,
  getDemandResult,
  getDemandWorkspace,
  getDemandHistory,
  getDemandIdea,
  requestDemandArticle,
  requestDemandIdeas,
  retryDemandRequest,
  startDemandSession,
  updateDemandIdeaEvent,
};

export type DemandReaderClient = typeof browserDemandReaderClient;

const suggestions = [
  "Health",
  "History",
  "Technology",
  "Science",
  "Sports",
  "Culture",
  "Cryptocurrency",
  "Startups",
  "Design",
  "Architecture",
  "Writing",
  "Art",
] as const;

type DemandView = "home" | "loop" | "library" | "profile" | "request" | "article";
type ReturnTarget = NonNullable<DemandContinuity["origin"]>;
type ClientAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  inFlight: boolean;
};

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function beginAttempt(
  reference: MutableRefObject<ClientAttempt | null>,
  fingerprint: string,
  prefix: string,
) {
  const previous = reference.current;
  if (previous?.inFlight) return null;
  if (previous?.fingerprint === fingerprint) {
    previous.inFlight = true;
    return previous;
  }
  const attempt = { fingerprint, idempotencyKey: idempotencyKey(prefix), inFlight: true };
  reference.current = attempt;
  return attempt;
}

function finishAttempt(
  reference: MutableRefObject<ClientAttempt | null>,
  attempt: ClientAttempt,
  succeeded: boolean,
) {
  attempt.inFlight = false;
  if (succeeded && reference.current === attempt) reference.current = null;
}

function beginScopedAttempt(
  reference: MutableRefObject<Map<string, ClientAttempt>>,
  scope: string,
  fingerprint: string,
  prefix: string,
) {
  const previous = reference.current.get(scope);
  if (previous?.inFlight) return null;
  if (previous?.fingerprint === fingerprint) {
    previous.inFlight = true;
    return previous;
  }
  const attempt = { fingerprint, idempotencyKey: idempotencyKey(prefix), inFlight: true };
  reference.current.set(scope, attempt);
  return attempt;
}

function finishScopedAttempt(
  reference: MutableRefObject<Map<string, ClientAttempt>>,
  scope: string,
  attempt: ClientAttempt,
  succeeded: boolean,
) {
  attempt.inFlight = false;
  if (succeeded && reference.current.get(scope) === attempt) {
    reference.current.delete(scope);
  }
}

function readDraft(kind: "feedback" | "question", ownerId: string, maxLength: number) {
  try {
    return (localStorage.getItem(`edison:demand:${kind}:${ownerId}`) ?? "").slice(0, maxLength);
  } catch {
    return "";
  }
}

function writeDraft(kind: "feedback" | "question", ownerId: string, draft: string) {
  try {
    const key = `edison:demand:${kind}:${ownerId}`;
    if (draft) localStorage.setItem(key, draft);
    else localStorage.removeItem(key);
  } catch {
    // Draft persistence is optional; server ownership and request recovery are not.
  }
}

function readPendingRequest(kind: "feedback" | "question", ownerId: string) {
  try {
    const value = localStorage.getItem(`edison:demand:${kind}-request:${ownerId}`);
    return value && /^[0-9a-f-]{36}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writePendingRequest(
  kind: "feedback" | "question",
  ownerId: string,
  requestId: string | null,
) {
  try {
    const key = `edison:demand:${kind}-request:${ownerId}`;
    if (requestId) localStorage.setItem(key, requestId);
    else localStorage.removeItem(key);
  } catch {
    // Request identity also remains durable in the server workspace.
  }
}

function readSubmittedFeedback(loopId: string): SubmittedDemandFeedback | null {
  try {
    const raw = localStorage.getItem(`edison:demand:feedback-submitted:${loopId}`);
    if (!raw || raw.length > 2000) return null;
    const value = JSON.parse(raw) as Partial<SubmittedDemandFeedback>;
    return (value.operation === "apply" || value.operation === "undo") && typeof value.text === "string" && value.text.length <= 500 &&
      (value.requestId === null || typeof value.requestId === "string" && /^[0-9a-f-]{36}$/.test(value.requestId))
      ? value as SubmittedDemandFeedback : null;
  } catch { return null; }
}

function writeSubmittedFeedback(loopId: string, value: SubmittedDemandFeedback) {
  try { localStorage.setItem(`edison:demand:feedback-submitted:${loopId}`, JSON.stringify(value)); } catch { /* Optional local recovery. */ }
}

function readStoredAttempt(kind: "feedback" | "question", ownerId: string) {
  try {
    const raw = localStorage.getItem(`edison:demand:${kind}-attempt:${ownerId}`);
    if (!raw || raw.length > 2_000) return null;
    const value = JSON.parse(raw) as Partial<ClientAttempt>;
    if (typeof value.fingerprint !== "string" || value.fingerprint.length > 1_600 ||
        typeof value.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)) return null;
    return { fingerprint: value.fingerprint, idempotencyKey: value.idempotencyKey, inFlight: false };
  } catch {
    return null;
  }
}

function writeStoredAttempt(
  kind: "feedback" | "question",
  ownerId: string,
  attempt: ClientAttempt | null,
) {
  try {
    const key = `edison:demand:${kind}-attempt:${ownerId}`;
    if (attempt) {
      localStorage.setItem(key, JSON.stringify({
        fingerprint: attempt.fingerprint,
        idempotencyKey: attempt.idempotencyKey,
      }));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // The in-memory attempt still prevents duplicate submits in this session.
  }
}

function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Edison could not complete that request. Please try again.";
}

function requestStage(stage: DemandRequest["stage"]) {
  const labels: Record<DemandRequest["stage"], string> = {
    queued: "Queued",
    researching: "Researching sources",
    "checking-ideas": "Checking the article ideas",
    writing: "Preparing your explanation",
    checking: "Checking your explanation",
    repairing: "Rechecking a revision",
    updating: "Updating this loop",
    answering: "Preparing your answer",
    ready: "Ready",
    failed: "Couldn’t finish",
  };
  return labels[stage];
}

function canRequestFreshIdeasAfter(code: string | undefined) {
  return code === "evidence_unavailable" ||
    code === "provider_invalid" ||
    code === "loop_changed";
}

function latestRequest(
  workspace: DemandWorkspace,
  loopId: string,
  kind: DemandRequest["kind"],
) {
  return workspace.requests
    .filter((request) => request.loopId === loopId && request.kind === kind)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function demandIdeaAction(idea: DemandIdea, request?: DemandRequest) {
  if (!idea.articleRequestId || request?.status === "succeeded") return "Read article";
  if (request?.status === "failed") return "View status";
  if (!request) return "Open article";
  return request.stage === "checking" || request.stage === "repairing"
    ? "Checking explanation…" : request.stage === "researching" ? "Researching…" : "Preparing…";
}

export function restoreDemandDialogFocus(opener: HTMLElement | null, fallback: HTMLElement | null) {
  const target = [opener, fallback].find((element) => element?.isConnected &&
    !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true");
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

function dialogOpener(event?: { currentTarget: EventTarget | null }) {
  const element = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  return element instanceof HTMLElement && element !== document.body ? element : null;
}

function useDemandGrowingTextarea(value: string, open: boolean, minimum: number) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const resize = () => {
      const element = textarea.current;
      if (!element) return;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const maximum = Math.max(minimum, Math.min(240, viewportHeight * 0.4));
      element.style.height = "auto";
      element.style.height = `${Math.max(minimum, Math.min(element.scrollHeight, maximum))}px`;
      element.style.overflowY = element.scrollHeight > maximum ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [value, open, minimum]);
  return textarea;
}

type DialogFocusProps = {
  openerRef: MutableRefObject<HTMLElement | null>;
  fallbackRef: MutableRefObject<HTMLElement | null>;
};

function IdeaCard({
  idea,
  request,
  saving,
  onOpen,
  onSave,
}: {
  idea: DemandIdea;
  request?: DemandRequest;
  saving: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const titleId = useId();
  const action = demandIdeaAction(idea, request);

  return (
    <article className="demand-idea-card" data-idea-id={idea.id}>
      <button
        type="button"
        className="demand-idea-open-target"
        aria-label={`${action}: ${idea.title}`}
        onClick={onOpen}
      />
      <div className="demand-idea-copy">
        <p className="demand-idea-meta">
          <span>Article idea</span>
          {request && request.status !== "succeeded" ? (
            <><span aria-hidden="true"> · </span><span>{requestStage(request.stage)}</span></>
          ) : null}
        </p>
        <h2 id={titleId}>{idea.title}</h2>
        <p>{idea.deck}</p>
        <div className="demand-idea-footer">
          <span className="demand-idea-action" aria-hidden="true">
            {action}<ArrowRight />
          </span>
          <button
            type="button"
            className="demand-save-action"
            aria-label={idea.saved ? `Remove saved idea: ${idea.title}` : `Save idea: ${idea.title}`}
            aria-pressed={idea.saved}
            disabled={saving}
            onClick={onSave}
          >
            {saving ? <LoaderCircle className="demand-spin" /> : <Bookmark fill={idea.saved ? "currentColor" : "none"} />}
          </button>
        </div>
      </div>
    </article>
  );
}

function CreateLoopDialog({
  open,
  draft,
  pending,
  error,
  onOpenChange,
  onDraftChange,
  onSubmit,
  openerRef,
  fallbackRef,
}: DialogFocusProps & {
  open: boolean;
  draft: string;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const textarea = useDemandGrowingTextarea(draft, open, 60);
  const content = useEditorialDialogViewport(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="demand-dialog demand-create-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDemandDialogFocus(openerRef.current, fallbackRef.current);
        }}
      >
        <DialogClose className="demand-dialog-close" aria-label="Close new loop">
          <X aria-hidden="true" />
        </DialogClose>
        <DialogTitle>What do you want to learn about?</DialogTitle>
        <DialogDescription id={`${id}-description`} className="demand-visually-hidden">
          Create a learning loop from any topic or question.
        </DialogDescription>
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() && !pending) onSubmit();
          }}
        >
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            maxLength={500}
            required
            readOnly={pending}
            aria-label="What do you want to learn about?"
            aria-invalid={Boolean(error)}
            placeholder="e.g. art, history, synthetic biology, writing, etc."
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <div className="demand-suggestions">
            <p>Suggested topics</p>
            <div>
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  disabled={pending}
                  onClick={() => {
                    onDraftChange(suggestion);
                    textarea.current?.focus({ preventScroll: true });
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          {error ? <p id={`${id}-error`} className="demand-dialog-error" role="alert">{error}</p> : null}
          <div className="demand-dialog-footer">
            <button type="submit" className="demand-primary" disabled={!draft.trim() || pending}>
              {pending ? "Creating loop…" : "Create loop"}<ArrowRight aria-hidden="true" />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CurateLoopDialog({
  loop,
  loops,
  chooseLoop,
  onChooseLoop,
  open,
  draft,
  pending,
  error,
  status,
  onOpenChange,
  onDraftChange,
  onSubmit,
  onUndo,
  openerRef,
  fallbackRef,
}: DialogFocusProps & {
  loop: DemandLoop | null;
  loops: DemandLoop[];
  chooseLoop: boolean;
  onChooseLoop: (id: string) => void;
  open: boolean;
  draft: string;
  pending: boolean;
  error: string;
  status: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onUndo: () => void;
}) {
  const id = useId();
  const textarea = useDemandGrowingTextarea(draft, open, 96);
  const content = useEditorialDialogViewport(open);
  const selector = useRef<HTMLSelectElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="demand-dialog demand-curate-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-scope${error ? ` ${id}-error` : ""}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (loop ? textarea.current : selector.current)?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDemandDialogFocus(openerRef.current, fallbackRef.current);
        }}
      >
        <DialogClose className="demand-dialog-close" aria-label="Close Curate">
          <X aria-hidden="true" />
        </DialogClose>
        <p className="demand-dialog-scope" id={`${id}-scope`}>{loop?.title ?? "Choose the loop to update"}</p>
        <DialogTitle>How can we improve this loop for you?</DialogTitle>
        <DialogDescription className="demand-visually-hidden">
          Review and update the explicit principles shaping this loop.
        </DialogDescription>
        {chooseLoop ? <div className="demand-loop-selector"><label htmlFor={`${id}-loop`}>Which loop?</label><select ref={selector} id={`${id}-loop`} value={loop?.id ?? ""} disabled={pending} onChange={(event) => onChooseLoop(event.target.value)}><option value="" disabled>Choose a loop</option>{loops.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div> : null}
        {loop ? <><section className="demand-principles" aria-labelledby={`${id}-principles`}>
          <h3 id={`${id}-principles`}>What’s shaping this loop</h3>
          <ul>
            {loop?.principles.map((principle) => (
              <li key={principle.id}>
                {principle.instruction}{" "}
                <span>— {principle.kind === "knowledge" ? "your declared knowledge" : principle.kind === "preference" ? "your preference" : "your direction"}</span>
              </li>
            ))}
            <li>Explanations are checked for accuracy and useful detail <span>— Edison default</span></li>
          </ul>
        </section>
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() && !pending) onSubmit();
          }}
        >
          <label htmlFor={`${id}-feedback`}>Tell us what to change</label>
          <textarea
            id={`${id}-feedback`}
            ref={textarea}
            value={draft}
            rows={3}
            maxLength={500}
            required
            readOnly={pending}
            aria-invalid={Boolean(error)}
            placeholder="e.g. Make articles shorter and include more examples"
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <p className="demand-feedback-scope">For future ideas and articles in this loop.</p>
          {pending ? <p className="demand-dialog-status" role="status">Updating this loop…</p> : null}
          {!pending && (status || (loop?.canUndo && loop.lastMutationId)) ? (
            <p className="demand-dialog-status" role="status">
              {status || "Your latest loop update is saved."}
              {loop?.canUndo && loop.lastMutationId ? (
                <button type="button" onClick={onUndo}>Undo</button>
              ) : null}
            </p>
          ) : null}
          {error ? <p id={`${id}-error`} className="demand-dialog-error" role="alert">{error}</p> : null}
          <div className="demand-dialog-footer">
            <button type="submit" className="demand-primary" disabled={!draft.trim() || pending}>
              {pending ? "Updating…" : "Update loop"}<ArrowRight aria-hidden="true" />
            </button>
          </div>
        </form></> : null}
      </DialogContent>
    </Dialog>
  );
}

function ArticleQuestionDialog({
  open, article, draft, pending, status, error, answer, loadFailed,
  onOpenChange, onDraftChange, onSubmit, onLoadAgain, openerRef, fallbackRef,
}: DialogFocusProps & {
  open: boolean;
  article: DemandArticle | null;
  draft: string;
  pending: boolean;
  status: string;
  error: string;
  answer: DemandAnswer | null;
  loadFailed: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: (event: FormEvent) => void;
  onLoadAgain: () => void;
}) {
  const id = useId();
  const textarea = useDemandGrowingTextarea(draft, open, 68);
  const content = useEditorialDialogViewport(open);
  return (
    <Dialog open={open && Boolean(article)} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="demand-dialog demand-question-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-article${error ? ` ${id}-error` : ""}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDemandDialogFocus(openerRef.current, fallbackRef.current);
        }}
      >
        <DialogClose className="demand-dialog-close" aria-label="Close article question"><X aria-hidden="true" /></DialogClose>
        <DialogTitle>Ask about this article</DialogTitle>
        <DialogDescription id={`${id}-article`} className="demand-question-context">{article?.title}</DialogDescription>
        <form aria-busy={pending} onSubmit={onSubmit}>
          <label className="demand-visually-hidden" htmlFor={`${id}-question`}>Your question</label>
          <textarea id={`${id}-question`} ref={textarea} value={draft} maxLength={1000} rows={2}
            readOnly={pending} aria-invalid={Boolean(error)} placeholder="Ask a question about this article"
            onChange={(event) => onDraftChange(event.target.value)} />
          <div className="demand-dialog-footer">
            <button className="demand-primary" type="submit" disabled={!draft.trim() || pending}>
              {pending ? status : "Ask Edison"}<ArrowRight aria-hidden="true" />
            </button>
          </div>
        </form>
        {pending ? <p className="demand-dialog-status" role="status">{status}</p> : null}
        {error ? <p id={`${id}-error`} className="demand-dialog-error" role="alert">{error}</p> : null}
        {loadFailed ? <button type="button" className="demand-text-action" onClick={onLoadAgain}>Load answer again</button> : null}
        {answer ? <DemandAnswerContent answer={answer} articleSources={article?.sources ?? []} pending={pending} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CitationLinks({
  block,
  sources,
}: {
  block: Exclude<ArticleBlock, { type: "heading" }>;
  sources: ArticleSource[];
}) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return block.citations.length ? (
    <sup className="demand-citations">
      {block.citations.map((citation) => {
        const source = byId.get(citation.sourceId);
        return source ? (
          <a key={`${citation.sourceId}-${citation.label}`} href={source.url} target="_blank" rel="noreferrer" aria-label={`Source: ${source.title}`}>
            {citation.label}
          </a>
        ) : null;
      })}
    </sup>
  ) : null;
}

export function DemandSourceList({ sources }: { sources: ArticleSource[] }) {
  if (!sources.length) return null;
  return (
    <section className="demand-sources">
      <h2>Sources</h2>
      <ol>{sources.map((source, index) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer"><span>{index + 1}</span><div><strong>{source.publisher}</strong><small>{source.title}</small></div></a></li>)}</ol>
    </section>
  );
}

export function DemandReadingMetadata({ article }: { article: Pick<DemandArticle, "readingMinutes" | "sources"> }) {
  return <small>{article.readingMinutes} min{article.sources.length ? ` · ${article.sources.length} ${article.sources.length === 1 ? "source" : "sources"}` : ""}</small>;
}

export function DemandAnswerContent({ answer, articleSources, pending = false }: {
  answer: DemandAnswer;
  articleSources: ArticleSource[];
  pending?: boolean;
}) {
  // Only historical answers borrow their saved article's aggregate references.
  // V2 resolves every inline citation against the answer's own validated sources.
  const legacy = "text" in answer;
  const sourceById = new Map(articleSources.map((source) => [source.id, source]));
  const sources = legacy
    ? [...new Set(answer.sourceIds)].flatMap((sourceId) => sourceById.has(sourceId) ? [sourceById.get(sourceId)!] : [])
    : answer.sources;
  const missingLegacySources = legacy && answer.sourceIds.some((sourceId) => !sourceById.has(sourceId));
  return (
    <div className="demand-answer" aria-live="polite">
      <strong>{pending ? "Previous answer" : "Edison"}</strong>
      {legacy ? <p>{answer.text}</p> : answer.body.map((block, index) => {
        if (block.type === "heading") return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
        if (block.type === "quote") return <blockquote key={`${block.text}-${index}`}>{block.text}{block.attribution ? <cite>— {block.attribution}</cite> : null}<CitationLinks block={block} sources={sources} /></blockquote>;
        return <p key={`${block.text}-${index}`}>{block.text}<CitationLinks block={block} sources={sources} /></p>;
      })}
      <DemandSourceList sources={sources} />
      {missingLegacySources ? <p className="demand-answer-sources">Some saved source references are unavailable.</p> : null}
    </div>
  );
}

export function DemandReader({
  client = browserDemandReaderClient,
  initialWorkspace = null,
}: {
  client?: DemandReaderClient;
  initialWorkspace?: DemandWorkspace | null;
}) {
  const initialLoop = initialWorkspace?.loops[0];
  const [workspace, setWorkspace] = useState<DemandWorkspace | null>(initialWorkspace);
  const [workspaceResponses] = useState(() => new DemandWorkspaceResponses(initialWorkspace));
  const [historyReader] = useState(() => { const reader = new DemandReaderHistory(); if (initialWorkspace) reader.reset(initialWorkspace.workspaceId); return reader; });
  const [history, setHistory] = useState(() => historyReader.snapshot());
  const [recoveringContinuity, setRecoveringContinuity] = useState(false);
  const [continuityFailure, setContinuityFailure] = useState("");
  const [continuityIntent, setContinuityIntent] = useState(0);
  const [ideaRecoveryErrors, setIdeaRecoveryErrors] = useState<Map<string, string>>(() => new Map());
  const [view, setView] = useState<DemandView>(initialLoop ? "loop" : "home");
  const [activeLoopId, setActiveLoopId] = useState(initialLoop?.id ?? PULSE_FOR_YOU_ID);
  const [createOpen, setCreateOpen] = useState(Boolean(initialWorkspace && !initialLoop));
  const [createDraft, setCreateDraft] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [curateOpen, setCurateOpen] = useState(false);
  const [curateLoopId, setCurateLoopId] = useState<string | null>(null);
  const [chooseCurateLoop, setChooseCurateLoop] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackRequestId, setFeedbackRequestId] = useState<string | null>(null);
  const [feedbackSubmittingLoopId, setFeedbackSubmittingLoopId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<DemandArticle | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [questionRequestId, setQuestionRequestId] = useState<string | null>(null);
  const [questionSubmittingIdeaId, setQuestionSubmittingIdeaId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<DemandAnswer | null>(null);
  const [savingIdeas, setSavingIdeas] = useState<Set<string>>(() => new Set());
  const [ideasSubmittingLoopId, setIdeasSubmittingLoopId] = useState<string | null>(null);
  const [retryingRequestId, setRetryingRequestId] = useState<string | null>(null);
  const [resultLoadNonce, setResultLoadNonce] = useState(0);
  const [answerLoadNonce, setAnswerLoadNonce] = useState(0);
  const [resultLoadFailed, setResultLoadFailed] = useState(false);
  const [answerLoadFailed, setAnswerLoadFailed] = useState(false);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);
  const [pageError, setPageError] = useState("");
  const [loading, setLoading] = useState(initialWorkspace === null);
  const openedIdeas = useRef(new Set<string>());
  const selectedIdeaRef = useRef<string | null>(null);
  const activeLoopRef = useRef(activeLoopId);
  const createAttemptRef = useRef<ClientAttempt | null>(null);
  const feedbackAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const questionAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const ideasAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const articleAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const retryingRequestIds = useRef(new Set<string>());
  const savingIdeaIds = useRef(new Set<string>());
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const createOpenerRef = useRef<HTMLElement | null>(null);
  const curateOpenerRef = useRef<HTMLElement | null>(null);
  const askOpenerRef = useRef<HTMLElement | null>(null);
  const continuityRestored = useRef(false);
  const navigationIntentRef = useRef(0);
  const articlePositionRef = useRef(0);
  const readingPositionsRef = useRef<DemandReadingPositions | null>(null);
  const restoringArticleRef = useRef<string | null>(null);
  const pendingHistoryReturn = useRef<ReturnTarget | null>(null);
  const submittedFeedbackRefs = useRef(new Map<string, SubmittedDemandFeedback>());
  const workspaceIdentityRef = useRef(initialWorkspace?.workspaceId ?? null);
  const curateLoopRef = useRef<string | null>(null);

  const publishWorkspace = useCallback((next: DemandWorkspace | null) => {
    if (!next) return false;
    const changed = Boolean(workspaceIdentityRef.current && workspaceIdentityRef.current !== next.workspaceId);
    if (changed) {
      // A principal change is a new workspace, never a union or a stale article.
      navigationIntentRef.current++;
      continuityRestored.current = true;
      setRecoveringContinuity(false);
      setContinuityFailure("");
      selectedIdeaRef.current = null;
      curateLoopRef.current = null;
      activeLoopRef.current = next.loops[0]?.id ?? PULSE_FOR_YOU_ID;
      setActiveLoopId(activeLoopRef.current);
      setView(next.loops.length ? "loop" : "home");
      setSelectedIdeaId(null);
      setSelectedRequestId(null);
      setSelectedArticle(null);
      setReturnTarget(null);
      setQuestion("");
      setAnswer(null);
      setQuestionRequestId(null);
      setFeedbackDraft("");
      setFeedbackRequestId(null);
      setCurateLoopId(null);
      setCurateOpen(false);
      setAskOpen(false);
      setCreateOpen(false);
      setCreateDraft("");
      setPageError("");
      setIdeaRecoveryErrors(new Map());
      articlePositionRef.current = 0;
      readingPositionsRef.current = restoreDemandReadingPositions(null, next.workspaceId);
      restoringArticleRef.current = null;
      pendingHistoryReturn.current = null;
    }
    workspaceIdentityRef.current = next.workspaceId;
    historyReader.syncWorkspace(next);
    setHistory(historyReader.snapshot());
    setWorkspace(next);
    return !changed;
  }, [historyReader]);

  const loadHistoryPage = useCallback(async (query: HistoryScope, cursor: string | null, refresh = false) => {
    if (!historyReader.snapshot().workspaceId) return;
    const ticket = historyReader.beginPage(query, cursor, refresh);
    setHistory(historyReader.snapshot());
    try {
      const page = await client.getDemandHistory({ ...query, ...(cursor ? { cursor } : {}) });
      if (historyReader.acceptPage(ticket, page)) setHistory(historyReader.snapshot());
    } catch (error) {
      if (historyReader.failPage(ticket, readableError(error))) setHistory(historyReader.snapshot());
    }
  }, [client, historyReader]);

  const recoverIdea = useCallback(async (ideaId: string, mutation = false): Promise<DemandIdeaResult | null> => {
    const ticket = historyReader.beginExact(ideaId, mutation);
    if (!ticket) return null;
    try {
      const result = await client.getDemandIdea(ideaId);
      if (!historyReader.acceptExact(ticket, result)) return null;
      setHistory(historyReader.snapshot());
      setIdeaRecoveryErrors((current) => { const next = new Map(current); next.delete(ideaId); return next; });
      return result;
    } catch (error) {
      if (historyReader.exactIsCurrent(ticket)) throw error;
      return null;
    }
  }, [client, historyReader]);
  const readingRecords = useMemo(() => demandHistoryRecords(workspace, history), [workspace, history]);
  const historyQuery: HistoryScope | null = view === "library" ? { scope: "saved" }
    : view === "home" ? { scope: "all" } : view === "loop" ? { scope: "all", loopId: activeLoopId } : null;
  const visibleHistory = historyQuery && history.window && demandHistoryScopeKey(historyQuery) === demandHistoryScopeKey(history.window.query) ? history.window : null;
  useEffect(() => {
    const target = pendingHistoryReturn.current;
    if (!target?.history || !visibleHistory?.page || visibleHistory.cursor !== target.history.cursor ||
      demandHistoryScopeKey(visibleHistory.query) !== demandHistoryScopeKey(target.history)) return;
    pendingHistoryReturn.current = null;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, target.scrollY);
      (document.querySelector<HTMLButtonElement>(`[data-idea-id="${target.ideaId}"] .demand-idea-open-target`) ?? readingSurfaceRef.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleHistory]);

  useEffect(() => {
    let current = true;
    // Captured by initial mount or an explicit Retry, before either network wait.
    // A newer destination never grants this old restoration a new intent.
    const isCurrentIntent = () => current && navigationIntentRef.current === continuityIntent;
    const failRestoration = (error: unknown) => {
      setContinuityFailure(readableError(error));
      setRecoveringContinuity(false);
    };
    const restore = async (next: DemandWorkspace) => {
      if (!current) return;
      publishWorkspace(workspaceResponses.hydrate(next));
      setLoading(false);
      if (!isCurrentIntent()) return;
      continuityRestored.current = false;
      let raw: string | null = null;
      let positions: string | null = null;
      try {
        raw = localStorage.getItem("edison:demand:continuity:v1");
        positions = localStorage.getItem("edison:demand:reading-positions:v1");
      } catch { /* A fresh session remains usable. */ }
      readingPositionsRef.current = restoreDemandReadingPositions(positions, next.workspaceId);
      setContinuityFailure("");
      setRecoveringContinuity(true);
      await restoreCurrentDemandContinuity({ raw, workspace: next, getIdea: client.getDemandIdea,
        isCurrent: () => isCurrentIntent() && workspaceIdentityRef.current === next.workspaceId,
        onFailure: failRestoration,
        onRestored: (recovered) => {
          for (const result of recovered.recovered) historyReader.seed(result);
          setHistory(historyReader.snapshot());
          const saved = recovered.saved;
          setRecoveringContinuity(false);
          continuityRestored.current = true;
          if (saved) {
            activeLoopRef.current = saved.activeLoopId;
            setActiveLoopId(saved.activeLoopId);
            setView(saved.view === "article" ? "request" : saved.view);
            setReturnTarget(saved.origin);
            setSelectedIdeaId(saved.selectedIdeaId);
            selectedIdeaRef.current = saved.selectedIdeaId;
            const idea = next.ideas.find(({ id }) => id === saved.selectedIdeaId) ?? recovered.recovered.find(({ idea }) => idea.id === saved.selectedIdeaId)?.idea;
            setSelectedRequestId(idea?.articleRequestId ?? null);
            const restoredPosition = restoredDemandArticlePosition(saved);
            articlePositionRef.current = restoredPosition ?? 0;
            restoringArticleRef.current = restoredPosition !== null ? saved.selectedIdeaId : null;
            if (idea) {
              setQuestion(readDraft("question", idea.id, 1000));
              const pending = readPendingRequest("question", idea.id);
              const previous = next.requests.filter((request) => request.ideaId === idea.id && request.kind === "question")
                .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
              setQuestionRequestId(previous.find(({ id }) => id === pending)?.id ?? previous[0]?.id ?? null);
            }
            if (saved.history ?? saved.origin?.history) {
              const { cursor, ...query } = (saved.history ?? saved.origin!.history)!;
              void loadHistoryPage(query, cursor);
            } else if (saved.view === "library") void loadHistoryPage({ scope: "saved" }, null);
          } else if (next.loops.length) {
            activeLoopRef.current = next.loops[0]!.id;
            setActiveLoopId(next.loops[0]!.id);
            setView("loop");
          } else {
            setCreateOpen(true);
          }
        },
      });
    };
    if (initialWorkspace) {
      queueMicrotask(() => { void restore(initialWorkspace); });
      return () => { current = false; };
    }
    void client.startDemandSession().then(restore)
      .catch((error) => {
        if (!isCurrentIntent()) return;
        if (continuityIntent > 0) failRestoration(error);
        else setPageError(readableError(error));
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [client, continuityIntent, historyReader, initialWorkspace, loadHistoryPage, publishWorkspace, workspaceResponses]);

  useEffect(() => {
    if (!workspace || !continuityRestored.current) return;
    const persist = () => {
      // A late scroll event from leaving an article must not record the feed's
      // position against the article. Navigation clears this scope synchronously.
      if (view === "article" && selectedIdeaRef.current === selectedIdeaId && restoringArticleRef.current !== selectedIdeaId) {
        articlePositionRef.current = window.scrollY;
        const idea = readingRecords.ideas.find(({ id }) => id === selectedIdeaId);
        if (idea) readingPositionsRef.current = rememberDemandReadingPosition(readingPositionsRef.current, workspace.workspaceId, idea, window.scrollY);
      }
      const reading = view === "article" || view === "request";
      const saved: DemandContinuity = { version: 1, workspaceId: workspace.workspaceId, view,
        activeLoopId: view === "home" ? PULSE_FOR_YOU_ID : activeLoopId,
        selectedIdeaId: reading ? selectedIdeaId : null,
        origin: reading ? returnTarget : null, articleScrollY: reading ? articlePositionRef.current : 0 };
      if (visibleHistory) saved.history = { ...visibleHistory.query, cursor: visibleHistory.cursor };
      try {
        localStorage.setItem("edison:demand:continuity:v1", JSON.stringify(saved));
        if (readingPositionsRef.current?.workspaceId === workspace.workspaceId) {
          localStorage.setItem("edison:demand:reading-positions:v1", JSON.stringify(readingPositionsRef.current));
        }
      } catch { /* Optional device continuity. */ }
    };
    persist();
    window.addEventListener("scroll", persist, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => { window.removeEventListener("scroll", persist); window.removeEventListener("pagehide", persist); };
  }, [activeLoopId, readingRecords.ideas, returnTarget, selectedIdeaId, view, visibleHistory, workspace]);

  const hasRunningRequest = Boolean(
    workspace?.requests.some(({ status }) => status === "queued" || status === "running"),
  );
  useEffect(() => {
    if (!hasRunningRequest) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const ticket = workspaceResponses.beginPoll();
      try {
        const next = await client.getDemandWorkspace();
        if (!current) return;
        const accepted = workspaceResponses.acceptPoll(ticket, next);
        publishWorkspace(accepted);
      } catch (error) {
        if (current && workspaceResponses.isCurrentPoll(ticket)) setPageError(readableError(error));
      } finally {
        if (current) timer = setTimeout(refresh, 2_000);
      }
    };
    timer = setTimeout(refresh, 1_200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, hasRunningRequest, publishWorkspace, workspaceResponses]);

  const selectedRequest = readingRecords.requests.find(({ id }) => id === selectedRequestId);
  const selectedRequestStatus = selectedRequest?.status;
  const selectedRequestIdeaId = selectedRequest?.ideaId;
  const historyPollKey = history.window ? `${demandHistoryScopeKey(history.window.query)}:${history.window.cursor ?? "latest"}` : null;
  const historicalPending = Boolean(history.window?.page?.requests.some(({ status }) => status === "queued" || status === "running"));
  useEffect(() => {
    if (!historyPollKey || !historicalPending) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const window = historyReader.snapshot().window;
      if (!window || `${demandHistoryScopeKey(window.query)}:${window.cursor ?? "latest"}` !== historyPollKey) return;
      await loadHistoryPage(window.query, window.cursor, true);
      if (current) timer = setTimeout(refresh, 2_000);
    };
    timer = setTimeout(refresh, 2_000);
    return () => { current = false; clearTimeout(timer); };
  }, [historicalPending, historyPollKey, historyReader, loadHistoryPage]);

  const selectedPendingOutsidePage = Boolean(selectedIdeaId && (selectedRequestStatus === "queued" || selectedRequestStatus === "running") &&
    !history.window?.page?.requests.some(({ id }) => id === selectedRequestId));
  useEffect(() => {
    if (!selectedIdeaId || !selectedPendingOutsidePage || (view !== "request" && view !== "article")) return;
    const ideaId = selectedIdeaId;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { await recoverIdea(ideaId); }
      catch (error) { if (current && selectedIdeaRef.current === ideaId) setPageError(readableError(error)); }
      if (current) timer = setTimeout(refresh, 2_000);
    };
    timer = setTimeout(refresh, 2_000);
    return () => { current = false; clearTimeout(timer); };
  }, [recoverIdea, selectedIdeaId, selectedPendingOutsidePage, view]);
  useEffect(() => {
    if (
      view !== "request" ||
      !selectedRequestId ||
      !selectedIdeaId ||
      (selectedRequestStatus && (selectedRequestStatus !== "succeeded" || selectedRequestIdeaId !== selectedIdeaId))
    ) return;
    const resultIdeaId = selectedIdeaId;
    let current = true;
    void client.getDemandResult(selectedRequestId)
      .then((result) => {
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        if (result.request.ideaId !== resultIdeaId) throw new Error("Edison returned a different article request.");
        publishWorkspace(workspaceResponses.recoverRequest(result.request));
        if (!result.article) {
          if (result.request.status === "succeeded") throw new Error("Edison returned a ready request without its article.");
          return;
        }
        setSelectedArticle(result.article);
        setResultLoadFailed(false);
        setPageError("");
        setView("article");
      })
      .catch((error) => {
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        setResultLoadFailed(true);
        setPageError(readableError(error));
      });
    return () => {
      current = false;
    };
  }, [client, publishWorkspace, resultLoadNonce, selectedIdeaId, selectedRequestIdeaId, selectedRequestStatus, selectedRequestId, view, workspaceResponses]);

  const questionRequest = workspace?.requests.find(({ id }) => id === questionRequestId);
  useEffect(() => {
    if (
      questionRequestId &&
      questionRequest?.ideaId === selectedIdeaId &&
      questionRequest.status === "failed"
    ) {
      queueMicrotask(() => {
        if (selectedIdeaRef.current !== questionRequest.ideaId) return;
        if (questionRequest.ideaId) {
          writePendingRequest("question", questionRequest.ideaId, null);
          writeStoredAttempt("question", questionRequest.ideaId, null);
        }
        setPageError(questionRequest.failure?.message ?? "Edison couldn’t answer that question. Your draft is still here.");
        setQuestionRequestId(null);
      });
      return;
    }
    if (
      !questionRequestId ||
      !questionRequest?.ideaId ||
      questionRequest?.ideaId !== selectedIdeaId ||
      questionRequest.status !== "succeeded"
    ) return;
    const resultIdeaId = questionRequest.ideaId;
    let current = true;
    void client.getDemandResult(questionRequestId)
      .then((result) => {
        if (!result.answer) throw new Error("Edison returned a ready request without its answer.");
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        setAnswer(result.answer);
        setAnswerLoadFailed(false);
        const submitted = readPendingRequest("question", resultIdeaId) === questionRequestId
          ? readStoredAttempt("question", resultIdeaId) : null;
        const isAppliedDraft = (draft: string) => submitted?.fingerprint === JSON.stringify([resultIdeaId, draft.trim()]);
        setQuestion((draft) => isAppliedDraft(draft) ? "" : draft);
        if (isAppliedDraft(readDraft("question", resultIdeaId, 1000))) writeDraft("question", resultIdeaId, "");
        writePendingRequest("question", resultIdeaId, null);
        writeStoredAttempt("question", resultIdeaId, null);
        setPageError("");
        setQuestionRequestId(null);
      })
      .catch((error) => {
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        setAnswerLoadFailed(true);
        setPageError(readableError(error));
      });
    return () => {
      current = false;
    };
  }, [answerLoadNonce, client, questionRequest?.failure?.message, questionRequest?.ideaId, questionRequest?.status, questionRequestId, selectedIdeaId]);

  const feedbackRequest = workspace?.requests.find(({ id }) => id === feedbackRequestId);
  useEffect(() => {
    if (
      !feedbackRequestId ||
      !feedbackRequest ||
      feedbackRequest.loopId !== curateLoopId ||
      (feedbackRequest.status !== "succeeded" && feedbackRequest.status !== "failed")
    ) return;
    let current = true;
    if (feedbackRequest.status === "failed") {
      queueMicrotask(() => {
        if (!current || curateLoopRef.current !== feedbackRequest.loopId) return;
        setFeedbackError(feedbackRequest.failure?.message ?? "Edison couldn’t update this loop. Your feedback is still here.");
        writePendingRequest("feedback", feedbackRequest.loopId, null);
        writeStoredAttempt("feedback", feedbackRequest.loopId, null);
        setFeedbackRequestId(null);
      });
      return () => {
        current = false;
      };
    }
    queueMicrotask(() => {
      if (!current || curateLoopRef.current !== feedbackRequest.loopId) return;
      const submission = submittedFeedbackRefs.current.get(feedbackRequest.loopId) ?? readSubmittedFeedback(feedbackRequest.loopId);
      setFeedbackDraft((draft) => clearsSubmittedDemandFeedback(submission, feedbackRequest.id, draft) ? "" : draft);
      if (clearsSubmittedDemandFeedback(submission, feedbackRequest.id, readDraft("feedback", feedbackRequest.loopId, 500))) writeDraft("feedback", feedbackRequest.loopId, "");
      writePendingRequest("feedback", feedbackRequest.loopId, null);
      writeStoredAttempt("feedback", feedbackRequest.loopId, null);
      setFeedbackStatus(submission?.operation === "undo" ? "Previous loop update undone." : "Loop updated.");
      setFeedbackRequestId(null);
    });
    return () => {
      current = false;
    };
  }, [curateLoopId, feedbackRequest, feedbackRequestId]);

  useEffect(() => {
    if (!workspace) return;
    for (const loop of workspace.loops) {
      const requestId = readPendingRequest("feedback", loop.id);
      if (!requestId) continue;
      const request = workspace.requests.find(({ id }) => id === requestId);
      if (!request || request.status === "queued" || request.status === "running") continue;
      const submission = submittedFeedbackRefs.current.get(loop.id) ?? readSubmittedFeedback(loop.id);
      if (request.status === "succeeded" && clearsSubmittedDemandFeedback(submission, request.id, readDraft("feedback", loop.id, 500))) writeDraft("feedback", loop.id, "");
      writePendingRequest("feedback", loop.id, null);
      writeStoredAttempt("feedback", loop.id, null);
    }
    for (const idea of workspace.ideas) {
      const requestId = readPendingRequest("question", idea.id);
      if (!requestId) continue;
      const request = workspace.requests.find(({ id }) => id === requestId);
      if (request?.status === "failed") {
        writePendingRequest("question", idea.id, null);
        writeStoredAttempt("question", idea.id, null);
      }
    }
  }, [workspace]);

  useEffect(() => {
    if (view !== "article" || !selectedArticle || !selectedIdeaId) return;
    const restoredPosition = restoringArticleRef.current === selectedIdeaId ? articlePositionRef.current : 0;
    window.scrollTo(0, restoredPosition);
    articlePositionRef.current = restoredPosition;
    restoringArticleRef.current = null;
    if (!openedIdeas.current.has(selectedIdeaId)) {
      openedIdeas.current.add(selectedIdeaId);
      void client.updateDemandIdeaEvent(selectedIdeaId, {
        type: "opened",
        idempotencyKey: `opened:${selectedIdeaId}`,
      }).catch(() => openedIdeas.current.delete(selectedIdeaId));
    }

    const reported = new Set<number>();
    const reportProgress = () => {
      const available = document.documentElement.scrollHeight - window.innerHeight;
      if (available <= 0) return;
      const progress = Math.min(100, Math.max(0, Math.round((window.scrollY / available) * 100)));
      const bucket = [100, 75, 50, 25].find((value) => progress >= value);
      if (!bucket || reported.has(bucket)) return;
      reported.add(bucket);
      void client.updateDemandIdeaEvent(selectedIdeaId, {
        type: "progress",
        progress: bucket,
        idempotencyKey: `progress:${selectedIdeaId}:${bucket}`,
      }).catch(() => reported.delete(bucket));
    };
    window.addEventListener("scroll", reportProgress, { passive: true });
    reportProgress();
    return () => window.removeEventListener("scroll", reportProgress);
  }, [client, selectedArticle, selectedIdeaId, view]);

  const activeLoop = workspace?.loops.find(({ id }) => id === activeLoopId) ?? null;
  const curateLoop = workspace?.loops.find(({ id }) => id === curateLoopId) ?? null;
  const combinedIdeas = useMemo(
    () => {
      const ideas = workspace?.ideas ?? [];
      const batchCreatedAt = new Map<string, string>();
      for (const idea of ideas) {
        const previous = batchCreatedAt.get(idea.batchRequestId);
        if (!previous || idea.createdAt > previous) {
          batchCreatedAt.set(idea.batchRequestId, idea.createdAt);
        }
      }
      return ideas.toSorted((left, right) => {
        const batchOrder = (batchCreatedAt.get(right.batchRequestId) ?? right.createdAt)
          .localeCompare(batchCreatedAt.get(left.batchRequestId) ?? left.createdAt);
        if (batchOrder) return batchOrder;
        if (left.batchRequestId === right.batchRequestId) return left.rank - right.rank;
        return right.batchRequestId.localeCompare(left.batchRequestId);
      });
    },
    [workspace?.ideas],
  );
  const activeIdeas = combinedIdeas.filter(({ loopId: owner }) => owner === activeLoopId);
  const ideaById = new Map(readingRecords.ideas.map((idea) => [idea.id, idea]));
  const requestById = new Map(readingRecords.requests.map((request) => [request.id, request]));
  const selectedIdea = selectedIdeaId ? ideaById.get(selectedIdeaId) ?? null : null;

  function rememberCurrentReadingPosition() {
    if (view !== "article" || !workspace || !selectedIdea || selectedIdeaRef.current !== selectedIdea.id) return;
    readingPositionsRef.current = rememberDemandReadingPosition(readingPositionsRef.current, workspace.workspaceId, selectedIdea, window.scrollY);
    try { localStorage.setItem("edison:demand:reading-positions:v1", JSON.stringify(readingPositionsRef.current)); } catch { /* Keep in-memory continuity if storage is unavailable. */ }
  }

  function beginNavigation() {
    navigationIntentRef.current++;
    continuityRestored.current = true;
    setRecoveringContinuity(false);
    setContinuityFailure("");
    setPageError("");
  }

  function retryContinuityRestoration() {
    continuityRestored.current = false;
    setContinuityFailure("");
    setRecoveringContinuity(true);
    setContinuityIntent(++navigationIntentRef.current);
  }

  async function commissionIdeas(loop: DemandLoop) {
    const fingerprint = `${loop.id}:${loop.revision}`;
    let attempt = ideasAttemptRefs.current.get(loop.id);
    if (attempt?.inFlight) return;
    if (attempt?.fingerprint !== fingerprint) {
      attempt = {
        fingerprint,
        idempotencyKey: idempotencyKey("ideas"),
        inFlight: false,
      };
      ideasAttemptRefs.current.set(loop.id, attempt);
    }
    attempt.inFlight = true;
    setIdeasSubmittingLoopId(loop.id);
    setPageError("");
    const ticket = workspaceResponses.beginMutation();
    historyReader.invalidateMutation();
    setHistory(historyReader.snapshot());
    try {
      const response = await client.requestDemandIdeas(loop.id, {
        baseRevision: loop.revision,
        idempotencyKey: attempt.idempotencyKey,
      });
      publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace));
      if (ideasAttemptRefs.current.get(loop.id) === attempt) {
        ideasAttemptRefs.current.delete(loop.id);
      }
    } catch (error) {
      if (activeLoopRef.current === loop.id) setPageError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      attempt.inFlight = false;
      setIdeasSubmittingLoopId((current) => current === loop.id ? null : current);
    }
  }

  async function createLoopAndIdeas() {
    if (!createDraft.trim()) return;
    const curiosity = createDraft.trim();
    const attempt = beginAttempt(createAttemptRef, curiosity, "create-loop");
    if (!attempt) return;
    setCreatePending(true);
    setCreateError("");
    let createdLoop = false;
    const ticket = workspaceResponses.beginMutation();
    try {
      const created = await client.createDemandLoop({
        curiosity,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, created.workspace))) return;
      const loop = created.workspace.loops.find(
        ({ id }) => !workspace?.loops.some((existing) => existing.id === id),
      ) ?? created.workspace.loops.find(
        ({ originalCuriosity }) =>
          originalCuriosity.trim().toLocaleLowerCase() === curiosity.toLocaleLowerCase(),
      );
      if (!loop) throw new Error("Edison did not return the new loop.");
      createdLoop = true;
      activeLoopRef.current = loop.id;
      setActiveLoopId(loop.id);
      setView("loop");
      setCreateDraft("");
      setCreateOpen(false);
      const existingIdeas = created.workspace.ideas.some(({ loopId }) => loopId === loop.id);
      const existingIdeasRequest = created.workspace.requests.some(
        ({ loopId, kind }) => loopId === loop.id && kind === "ideas",
      );
      if (!created.requestId && !existingIdeas && !existingIdeasRequest) {
        await commissionIdeas(loop);
      }
    } catch (error) {
      setCreateError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      finishAttempt(createAttemptRef, attempt, createdLoop);
      setCreatePending(false);
    }
  }

  async function askForIdeas(loop: DemandLoop) {
    await commissionIdeas(loop);
  }

  async function openIdea(inputIdea: DemandIdea) {
    const idea = demandHistoryRecords(workspace, historyReader.snapshot()).ideas.find(({ id }) => id === inputIdea.id) ?? inputIdea;
    rememberCurrentReadingPosition();
    beginNavigation();
    setAskOpen(false);
    if ((view === "loop" && activeLoopId === idea.loopId) || view === "library" || view === "home") {
      setReturnTarget({ view, loopId: view === "loop" ? idea.loopId : null, scrollY: window.scrollY, ideaId: idea.id,
        ...(visibleHistory ? { history: { ...visibleHistory.query, cursor: visibleHistory.cursor } } : {}) });
    } else if (view !== "article" && view !== "request") {
      setReturnTarget({ view: "loop", loopId: idea.loopId, scrollY: 0, ideaId: idea.id });
    }
    articlePositionRef.current = demandReadingPositionForIdea(readingPositionsRef.current, workspace?.workspaceId ?? "", idea);
    restoringArticleRef.current = idea.articleRequestId ? idea.id : null;
    selectedIdeaRef.current = idea.id;
    if (workspace) {
      historyReader.seed({ workspaceId: workspace.workspaceId, idea, request: idea.articleRequestId ? requestById.get(idea.articleRequestId) ?? null : null });
      setHistory(historyReader.snapshot());
    }
    activeLoopRef.current = idea.loopId;
    setSelectedIdeaId(idea.id);
    setSelectedRequestId(idea.articleRequestId);
    setSelectedArticle(null);
    setResultLoadFailed(false);
    setAnswerLoadFailed(false);
    const savedQuestionDraft = readDraft("question", idea.id, 1000);
    setQuestion(savedQuestionDraft);
    setAnswer(null);
    const questionRequests = workspace?.requests
      .filter(({ ideaId, kind }) => ideaId === idea.id && kind === "question")
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)) ?? [];
    const markedQuestionId = readPendingRequest("question", idea.id);
    const priorQuestion = questionRequests.find(({ id }) => id === markedQuestionId) ??
      questionRequests.find(({ status }) => !savedQuestionDraft || status !== "succeeded");
    setQuestionRequestId(priorQuestion?.id ?? null);
    setPageError("");
    setActiveLoopId(idea.loopId);
    window.scrollTo(0, 0);
    if (idea.articleRequestId) {
      // The selected-request effect recovers this exact retained ID even when
      // it is outside the bounded workspace. Opening never recommissions it.
      setView("request");
      return;
    }
    setView("request");
    let attempt = articleAttemptRefs.current.get(idea.id);
    if (!attempt) {
      attempt = {
        fingerprint: idea.id,
        idempotencyKey: idempotencyKey("article"),
        inFlight: false,
      };
      articleAttemptRefs.current.set(idea.id, attempt);
    }
    if (attempt.inFlight) return;
    attempt.inFlight = true;
    let commissioned = false;
    const ticket = workspaceResponses.beginMutation();
    historyReader.invalidateMutation(idea.id);
    setHistory(historyReader.snapshot());
    try {
      const response = await client.requestDemandArticle(idea.id, {
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      if (!response.requestId) throw new Error("Edison did not return the article request.");
      commissioned = true;
      historyReader.seed({ workspaceId: response.workspace.workspaceId, idea: { ...idea, articleRequestId: response.requestId },
        request: response.workspace.requests.find(({ id }) => id === response.requestId) ?? null }, true);
      setHistory(historyReader.snapshot());
      if (selectedIdeaRef.current === idea.id) setSelectedRequestId(response.requestId);
      const exact = await recoverIdea(idea.id, true);
      if (exact && selectedIdeaRef.current === idea.id) {
        if (!exact.idea.articleRequestId) throw new Error("The article request is saved. Reload this idea to recover its status.");
        setSelectedRequestId(exact.idea.articleRequestId);
      }
    } catch (error) {
      if (selectedIdeaRef.current === idea.id) setPageError(readableError(error));
      if (commissioned && workspaceIdentityRef.current === workspace?.workspaceId) setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24)));
    } finally {
      workspaceResponses.finishMutation(ticket);
      historyReader.finishMutation(idea.id);
      setHistory(historyReader.snapshot());
      attempt.inFlight = false;
      if (commissioned && articleAttemptRefs.current.get(idea.id) === attempt) {
        articleAttemptRefs.current.delete(idea.id);
      }
    }
  }

  async function toggleIdeaSave(idea: DemandIdea) {
    if (savingIdeaIds.current.has(idea.id)) return;
    savingIdeaIds.current.add(idea.id);
    setSavingIdeas((current) => new Set(current).add(idea.id));
    setPageError("");
    const ticket = workspaceResponses.beginMutation({ savedIdeaId: idea.id });
    historyReader.invalidateMutation(idea.id);
    setHistory(historyReader.snapshot());
    try {
      const response = await client.updateDemandIdeaEvent(idea.id, {
        type: "saved",
        saved: !idea.saved,
        idempotencyKey: idempotencyKey("save-idea"),
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      await recoverIdea(idea.id, true);
    } catch (error) {
      if (workspaceIdentityRef.current === workspace?.workspaceId) setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24)));
    } finally {
      workspaceResponses.finishMutation(ticket);
      historyReader.finishMutation(idea.id);
      setHistory(historyReader.snapshot());
      savingIdeaIds.current.delete(idea.id);
      setSavingIdeas((current) => { const next = new Set(current); next.delete(idea.id); return next; });
    }
  }

  async function submitFeedback(operation: "apply" | "undo") {
    const activeLoop = curateLoop;
    if (!activeLoop || feedbackSubmittingLoopId === activeLoop.id ||
        (feedbackRequestId && feedbackRequest?.loopId === activeLoop.id)) return;
    const fingerprint = JSON.stringify(operation === "apply"
      ? [activeLoop.id, operation, activeLoop.revision, feedbackDraft.trim()]
      : [activeLoop.id, operation, activeLoop.revision, activeLoop.lastMutationId]);
    if (!feedbackAttemptRefs.current.has(activeLoop.id)) {
      const stored = readStoredAttempt("feedback", activeLoop.id);
      if (stored) feedbackAttemptRefs.current.set(activeLoop.id, stored);
    }
    const attempt = beginScopedAttempt(feedbackAttemptRefs, activeLoop.id, fingerprint, "feedback");
    if (!attempt) return;
    writeStoredAttempt("feedback", activeLoop.id, attempt);
    setFeedbackSubmittingLoopId(activeLoop.id);
    setFeedbackError("");
    setFeedbackStatus("");
    let accepted = false;
    const submission: SubmittedDemandFeedback = { operation, text: feedbackDraft, requestId: null };
    submittedFeedbackRefs.current.set(activeLoop.id, submission);
    writeSubmittedFeedback(activeLoop.id, submission);
    const ticket = workspaceResponses.beginMutation();
    try {
      const response = await client.applyDemandFeedback(
        activeLoop.id,
        operation === "apply"
          ? {
              operation,
              text: feedbackDraft,
              baseRevision: activeLoop.revision,
              idempotencyKey: attempt.idempotencyKey,
            }
          : {
              operation,
              mutationId: activeLoop.lastMutationId!,
              baseRevision: activeLoop.revision,
              idempotencyKey: attempt.idempotencyKey,
            },
      );
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      accepted = true;
      submission.requestId = response.requestId ?? null;
      writeSubmittedFeedback(activeLoop.id, submission);
      if (response.requestId) {
        writePendingRequest("feedback", activeLoop.id, response.requestId);
      }
      if (response.requestId) {
        if (curateLoopRef.current === activeLoop.id) setFeedbackRequestId(response.requestId);
      } else {
        if (operation === "apply" && readDraft("feedback", activeLoop.id, 500) === submission.text) writeDraft("feedback", activeLoop.id, "");
        if (curateLoopRef.current === activeLoop.id) {
          if (operation === "apply") setFeedbackDraft((draft) => draft === submission.text ? "" : draft);
          setFeedbackStatus(operation === "undo" ? "Previous loop update undone." : "Loop updated.");
        }
      }
    } catch (error) {
      if (curateLoopRef.current === activeLoop.id) setFeedbackError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      finishScopedAttempt(feedbackAttemptRefs, activeLoop.id, attempt, accepted);
      setFeedbackSubmittingLoopId((current) => current === activeLoop.id ? null : current);
    }
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!selectedIdea || !question.trim() || questionSubmittingIdeaId === selectedIdea.id ||
        (questionRequestId && questionRequest?.ideaId === selectedIdea.id)) return;
    const fingerprint = JSON.stringify([selectedIdea.id, question.trim()]);
    if (!questionAttemptRefs.current.has(selectedIdea.id)) {
      const stored = readStoredAttempt("question", selectedIdea.id);
      if (stored) questionAttemptRefs.current.set(selectedIdea.id, stored);
    }
    const attempt = beginScopedAttempt(questionAttemptRefs, selectedIdea.id, fingerprint, "question");
    if (!attempt) return;
    writeStoredAttempt("question", selectedIdea.id, attempt);
    setQuestionSubmittingIdeaId(selectedIdea.id);
    setPageError("");
    let accepted = false;
    const ticket = workspaceResponses.beginMutation();
    try {
      const response = await client.askDemandQuestion(selectedIdea.id, {
        question,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      if (!response.requestId) throw new Error("Edison did not return the question request.");
      accepted = true;
      writePendingRequest("question", selectedIdea.id, response.requestId);
      if (selectedIdeaRef.current === selectedIdea.id) setQuestionRequestId(response.requestId);
    } catch (error) {
      if (selectedIdeaRef.current === selectedIdea.id) setPageError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      finishScopedAttempt(questionAttemptRefs, selectedIdea.id, attempt, accepted);
      setQuestionSubmittingIdeaId((current) => current === selectedIdea.id ? null : current);
    }
  }

  async function retryRequest(request: DemandRequest) {
    if (retryingRequestIds.current.has(request.id)) return;
    retryingRequestIds.current.add(request.id);
    setRetryingRequestId(request.id);
    setPageError("");
    const ticket = workspaceResponses.beginMutation();
    if (request.ideaId) historyReader.invalidateMutation(request.ideaId);
    setHistory(historyReader.snapshot());
    const retryWorkspaceId = workspace?.workspaceId;
    const isCurrent = () => workspaceIdentityRef.current === retryWorkspaceId && (request.kind === "article"
      ? selectedIdeaRef.current === request.ideaId
      : activeLoopRef.current === request.loopId && selectedIdeaRef.current === null);
    try {
      await runScopedDemandRequest({
        run: () => client.retryDemandRequest(request.id),
        isCurrent,
        onSharedResult: (response) => { publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace)); },
        onCurrentResult: (response) => {
          if (response.requestId && request.kind === "article") setSelectedRequestId(response.requestId);
        },
        onCurrentError: (error) => setPageError(readableError(error)),
      });
      if (request.ideaId && workspaceIdentityRef.current === retryWorkspaceId) {
        try { await recoverIdea(request.ideaId, true); }
        catch (error) { if (isCurrent()) setPageError(readableError(error)); }
      }
    } finally {
      workspaceResponses.finishMutation(ticket);
      if (request.ideaId) historyReader.finishMutation(request.ideaId);
      setHistory(historyReader.snapshot());
      retryingRequestIds.current.delete(request.id);
      setRetryingRequestId((current) => current === request.id ? null : current);
    }
  }

  function openLoop(loopId: string) {
    if (!workspace?.loops.some(({ id }) => id === loopId)) return;
    rememberCurrentReadingPosition();
    beginNavigation();
    pendingHistoryReturn.current = null;
    historyReader.close();
    setHistory(historyReader.snapshot());
    setAskOpen(false);
    selectedIdeaRef.current = null;
    activeLoopRef.current = loopId;
    setActiveLoopId(loopId);
    setSelectedArticle(null);
    setSelectedIdeaId(null);
    setSelectedRequestId(null);
    setView("loop");
  }

  function returnFromReading() {
    rememberCurrentReadingPosition();
    const target = returnTarget;
    beginNavigation();
    pendingHistoryReturn.current = target?.history ? target : null;
    setAskOpen(false);
    selectedIdeaRef.current = null;
    if (target?.view === "loop" && target.loopId) {
      activeLoopRef.current = target.loopId;
      setActiveLoopId(target.loopId);
    } else if (target?.view === "home") {
      activeLoopRef.current = PULSE_FOR_YOU_ID;
      setActiveLoopId(PULSE_FOR_YOU_ID);
    }
    setView(target?.view ?? "loop");
    requestAnimationFrame(() => {
      window.scrollTo(0, target?.scrollY ?? 0);
      if (target) {
        (document.querySelector<HTMLButtonElement>(
          `[data-idea-id="${target.ideaId}"] .demand-idea-open-target`,
        ) ?? readingSurfaceRef.current)?.focus({ preventScroll: true });
      }
    });
  }

  function openWorkspaceView(next: "home" | "library" | "profile") {
    rememberCurrentReadingPosition();
    beginNavigation();
    pendingHistoryReturn.current = null;
    if (next === "library") void loadHistoryPage({ scope: "saved" }, null);
    else { historyReader.close(); setHistory(historyReader.snapshot()); }
    setAskOpen(false);
    selectedIdeaRef.current = null;
    if (next === "home") {
      activeLoopRef.current = PULSE_FOR_YOU_ID;
      setActiveLoopId(PULSE_FOR_YOU_ID);
    }
    setView(next);
  }

  function openCreate(event?: { currentTarget: EventTarget | null }) {
    beginNavigation();
    createOpenerRef.current = dialogOpener(event);
    setCreateOpen(true);
  }

  function openAsk(event?: { currentTarget: EventTarget | null }) {
    if (!selectedIdea || !selectedArticle) return;
    askOpenerRef.current = dialogOpener(event);
    setAskOpen(true);
  }

  function chooseFeedbackLoop(loopId: string) {
    const loop = workspace?.loops.find(({ id }) => id === loopId);
    if (!loop) return;
    setCurateLoopId(loop.id);
    curateLoopRef.current = loop.id;
    setFeedbackDraft(readDraft("feedback", loop.id, 500));
    const markedFeedbackId = readPendingRequest("feedback", loop.id);
    const feedback = workspace?.requests.find(({ id }) => id === markedFeedbackId) ??
      (workspace ? latestRequest(workspace, loop.id, "feedback") : undefined);
    if (feedback && (feedback.status === "queued" || feedback.status === "running")) {
      writePendingRequest("feedback", loop.id, feedback.id);
    }
    setFeedbackRequestId(
      feedback && feedback.status !== "succeeded" ? feedback.id : null,
    );
    setFeedbackError("");
    setFeedbackStatus("");
  }

  function openCurate(event?: { currentTarget: EventTarget | null }) {
    if (!workspace?.loops.length) { openCreate(event); return; }
    curateOpenerRef.current = dialogOpener(event);
    const requiresChoice = view === "home" || !activeLoop;
    setChooseCurateLoop(requiresChoice);
    if (requiresChoice) {
      curateLoopRef.current = null;
      setCurateLoopId(null);
      setFeedbackDraft("");
      setFeedbackRequestId(null);
      setFeedbackError("");
      setFeedbackStatus("");
    } else chooseFeedbackLoop(activeLoop.id);
    setCurateOpen(true);
  }

  function ideaSaveBlocked(ideaId: string) {
    return savingIdeas.has(ideaId) || ideaRecoveryErrors.has(ideaId);
  }

  function renderIdeaRecoveryErrors(ideas: DemandIdea[]) {
    return ideas.filter(({ id }) => ideaRecoveryErrors.has(id)).map((idea) => (
      <div key={idea.id} className="demand-page-error" role="alert">
        <p>{idea.title}: {ideaRecoveryErrors.get(idea.id)}</p>
        <button type="button" className="demand-text-action" onClick={() => {
          void recoverIdea(idea.id).catch((error) => setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24))));
        }}>Reload saved status</button>
      </div>
    ));
  }

  function renderHistoryPage() {
    if (!visibleHistory) return null;
    const window = visibleHistory;
    const ideas = window.page?.ideas ?? [];
    return <section className="demand-history" aria-label={window.query.scope === "saved" ? "Saved reading history" : "Reading history"} aria-busy={window.loading}>
      {window.loading ? <p role="status">Loading {window.query.scope === "saved" ? "saved reading" : "reading history"}…</p> : null}
      {window.error ? <div className="demand-page-error" role="alert"><p>{window.error}</p><button type="button" className="demand-text-action" onClick={() => void loadHistoryPage(window.query, window.cursor)}>Try loading again</button></div> : null}
      {renderIdeaRecoveryErrors(ideas)}
      {ideas.length ? <div className="demand-idea-grid">{ideas.map((idea) => <IdeaCard key={idea.id} idea={ideaById.get(idea.id) ?? idea}
        request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined} saving={ideaSaveBlocked(idea.id)}
        onOpen={() => void openIdea(ideaById.get(idea.id) ?? idea)} onSave={() => void toggleIdeaSave(ideaById.get(idea.id) ?? idea)} />)}</div>
        : window.page && !window.loading ? <p>No {window.query.scope === "saved" ? "saved reading" : "article ideas"} on this page.</p> : null}
      <nav className="demand-history-controls" aria-label="Reading history pages">
        <button type="button" disabled={window.loading || window.cursor === null} onClick={() => void loadHistoryPage(window.query, null)}>Latest reading</button>
        <button type="button" disabled={window.loading || !window.page?.nextCursor} onClick={() => window.page?.nextCursor && void loadHistoryPage(window.query, window.page.nextCursor)}>Older reading<ArrowRight aria-hidden="true" /></button>
        {window.query.scope !== "saved" ? <button type="button" onClick={() => { historyReader.close(); setHistory(historyReader.snapshot()); }}>Back to latest ideas</button> : null}
      </nav>
    </section>;
  }

  function historyEntry(query: HistoryScope) {
    return <div className="demand-history-controls"><button type="button" onClick={() => void loadHistoryPage(query, null)}>Browse reading history<ArrowRight aria-hidden="true" /></button></div>;
  }

  function renderLoop() {
    if (!workspace || !activeLoop) return null;
    if (visibleHistory) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>{activeLoop.title}</h1><p className="demand-intro">Choose an article. We’ll write it for you.</p>{renderHistoryPage()}</main>;
    const ideasRequest = latestRequest(workspace, activeLoop.id, "ideas");
    const newestBatchId = activeIdeas[0]?.batchRequestId;
    const currentIdeas = activeIdeas.filter(({ batchRequestId }) => batchRequestId === newestBatchId);
    const earlierIdeas = activeIdeas.filter(({ batchRequestId }) => batchRequestId !== newestBatchId);
    const ideasPending = ideasSubmittingLoopId === activeLoop.id || Boolean(
      ideasRequest && (ideasRequest.status === "queued" || ideasRequest.status === "running"),
    );
    const canRetryIdeas = Boolean(ideasRequest?.failure?.retryable);
    const canRequestFreshIdeas = canRequestFreshIdeasAfter(ideasRequest?.failure?.code);
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed" aria-labelledby="demand-loop-heading">
        <h1 id="demand-loop-heading">{activeLoop.title}</h1>
        <p className="demand-intro">{activeLoop.originalCuriosity}</p>
        {activeLoop.principles.length ? (
          <button type="button" className="demand-direction-link" onClick={openCurate}>
            What’s shaping this loop · {activeLoop.principles.length} {activeLoop.principles.length === 1 ? "principle" : "principles"}
          </button>
        ) : null}
        {activeIdeas.length ? <p className="demand-choice-hint">Choose an article. We’ll write it for you.</p> : null}
        {ideasPending ? (
          <section className="demand-request-state" role="status" aria-live="polite">
            <EdisonMark />
            <div><h2>{ideasRequest ? requestStage(ideasRequest.stage) : "Starting your ideas"}</h2><p>Distinct article ideas will appear here after they’ve been checked.</p></div>
          </section>
        ) : null}
        {ideasRequest?.status === "failed" && !ideasPending ? (
          <section className="demand-request-state demand-request-failed" role="alert">
            <div><h2>We couldn’t finish these ideas.</h2><p>{ideasRequest.failure?.message ?? "Your loop is saved. Try again when you’re ready."}</p></div>
            {canRetryIdeas || canRequestFreshIdeas ? (
              <button
                type="button"
                disabled={retryingRequestId === ideasRequest.id || ideasSubmittingLoopId === activeLoop.id}
                onClick={() => void (canRetryIdeas
                  ? retryRequest(ideasRequest)
                  : askForIdeas(activeLoop))}
              >
                {canRetryIdeas ? "Try again" : "Find fresh ideas"}
              </button>
            ) : null}
          </section>
        ) : null}
        {pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors(activeIdeas)}
        {currentIdeas.length ? (
          <div className="demand-idea-grid">
            {currentIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined}
                saving={ideaSaveBlocked(idea.id)}
                onOpen={() => void openIdea(idea)}
                onSave={() => void toggleIdeaSave(idea)}
              />
            ))}
          </div>
        ) : null}
        {earlierIdeas.length ? (
          <section className="demand-earlier" aria-labelledby="demand-earlier-heading">
            <h2 id="demand-earlier-heading">Earlier ideas</h2>
            <div className="demand-idea-grid">
              {earlierIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined}
                  saving={ideaSaveBlocked(idea.id)}
                  onOpen={() => void openIdea(idea)}
                  onSave={() => void toggleIdeaSave(idea)}
                />
              ))}
            </div>
          </section>
        ) : null}
        {activeIdeas.length && !ideasPending && ideasRequest?.status !== "failed" ? (
          <div className="demand-feed-action">
            <button type="button" className="demand-primary" onClick={() => void askForIdeas(activeLoop)}>
              Find fresh ideas<ArrowRight />
            </button>
          </div>
        ) : !ideasPending && ideasRequest?.status !== "failed" ? (
          <section className="demand-empty">
            <h2>Find something worth reading next.</h2>
            <p>Edison will prepare distinct article ideas before writing the explanation you choose.</p>
            <button type="button" className="demand-primary" disabled={ideasSubmittingLoopId === activeLoop.id} onClick={() => void askForIdeas(activeLoop)}>
              {ideasSubmittingLoopId === activeLoop.id ? "Starting…" : "Find article ideas"}<ArrowRight />
            </button>
          </section>
        ) : null}
        {historyEntry({ scope: "all", loopId: activeLoop.id })}
      </main>
    );
  }

  function renderRequest() {
    const request = selectedRequest;
    const idea = selectedIdea;
    if (!idea) return renderLoop();
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-preparation">
        <button type="button" className="demand-text-action" onClick={returnFromReading}>
          <ChevronLeft />Browse other ideas
        </button>
        <p className="demand-kicker">Selected article</p>
        <h1>{idea.title}</h1>
        <p className="demand-intro">{idea.deck}</p>
        <section className={`demand-request-state${request?.status === "failed" ? " demand-request-failed" : ""}`} role={request?.status === "failed" ? "alert" : "status"}>
          {request?.status !== "failed" ? <EdisonMark /> : null}
          <div>
            <h2>{request ? requestStage(request.stage) : "Starting your article"}</h2>
            <p>{request?.status === "failed"
              ? request.failure?.message ?? "Your idea is saved. Try again, or explore another."
              : "You can browse other ideas. This article will stay attached to this idea when it’s ready."}</p>
          </div>
          {request?.status === "failed" ? (
            <button
              type="button"
              disabled={retryingRequestId === request.id}
              onClick={() => void (request.failure?.retryable ? retryRequest(request) : returnFromReading())}
            >
              {request.failure?.retryable ? "Try again" : "Browse other ideas"}
            </button>
          ) : null}
          {(!request || request.status === "succeeded") && !selectedArticle && resultLoadFailed ? (
            <button type="button" onClick={() => { setResultLoadFailed(false); setResultLoadNonce((value) => value + 1); }}>
              Load article again
            </button>
          ) : null}
        </section>
        {pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors([idea])}
      </main>
    );
  }

  function renderArticle() {
    if (!selectedArticle || !selectedIdea || !activeLoop) return renderRequest();
    const readingIdeas = returnTarget?.history && history.window?.page ? history.window.page.ideas : returnTarget?.view === "home" ? combinedIdeas
      : returnTarget?.view === "library" ? combinedIdeas.filter(({ saved }) => saved) : activeIdeas;
    const currentIndex = readingIdeas.findIndex(({ id }) => id === selectedIdea.id);
    const nextIdea = currentIndex >= 0 ? readingIdeas[currentIndex + 1] ?? null : null;
    const nextRequest = nextIdea?.articleRequestId ? requestById.get(nextIdea.articleRequestId) : undefined;
    const backLabel = returnTarget?.view === "home" ? "For You" : returnTarget?.view === "library" ? "Library" : activeLoop.title;
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-article">
        <div className="demand-article-toolbar">
          <button type="button" onClick={returnFromReading}><ChevronLeft />Back to {backLabel}</button>
          <div>
            <button type="button" aria-haspopup="dialog" aria-expanded={askOpen} onClick={openAsk}><MessageCircle aria-hidden="true" />Ask</button>
            <button type="button" aria-label={selectedIdea.saved ? "Remove from saved reading" : "Save article"} aria-pressed={selectedIdea.saved} disabled={ideaSaveBlocked(selectedIdea.id)} onClick={() => void toggleIdeaSave(selectedIdea)}>
              <Bookmark fill={selectedIdea.saved ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
        {pageError && !askOpen ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors([selectedIdea])}
        <header className="demand-article-head">
          <p className="demand-kicker">{selectedArticle.kicker}</p>
          <h1>{selectedArticle.title}</h1>
          <p className="demand-article-deck">{selectedArticle.deck}</p>
          <div className="demand-byline"><EdisonMark /><span><strong>Written by Edison for this loop</strong><DemandReadingMetadata article={selectedArticle} /></span></div>
        </header>
        <aside className="demand-why"><EdisonMark /><div><strong>Why Edison wrote this</strong><p>{selectedArticle.reason}</p></div></aside>
        <div className="demand-article-body">
          {selectedArticle.body.map((block, index) => {
            if (block.type === "heading") return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
            if (block.type === "quote") return <blockquote key={`${block.text}-${index}`}>{block.text}{block.attribution ? <cite>— {block.attribution}</cite> : null}<CitationLinks block={block} sources={selectedArticle.sources} /></blockquote>;
            return <p key={`${block.text}-${index}`}>{block.text}<CitationLinks block={block} sources={selectedArticle.sources} /></p>;
          })}
        </div>
        <DemandSourceList sources={selectedArticle.sources} />
        <nav className="demand-next" aria-label="Continue reading">
          {nextIdea ? <><p>Up next · {backLabel}</p><button type="button" onClick={() => void openIdea(nextIdea)}><span>{!nextIdea.articleRequestId ? "Write next article" : nextRequest?.status === "succeeded" ? "Next article" : "View next article"}: {nextIdea.title}</span><ArrowRight /></button></> : null}
          <button type="button" className="demand-end-back" onClick={returnFromReading}><ChevronLeft aria-hidden="true" />Back to {backLabel}</button>
        </nav>
      </main>
    );
  }

  function content() {
    if (loading) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading" role="status"><EdisonMark /><p>Opening your reading workspace…</p></main>;
    if (recoveringContinuity || continuityFailure) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading"><h1>{continuityFailure ? "We couldn’t restore your reading yet." : "Restoring your article…"}</h1>{continuityFailure ? <><p role="alert">{continuityFailure}</p><button type="button" className="demand-primary" onClick={retryContinuityRestoration}>Try restoring again</button><button type="button" className="demand-text-action" onClick={() => openWorkspaceView("library")}>Back to Library</button></> : <p role="status">Recovering the saved article and its original reading page.</p>}</main>;
    if (!workspace) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading"><h1>We couldn’t open your reading.</h1><p>{pageError}</p><button type="button" className="demand-primary" onClick={() => window.location.reload()}>Try again</button></main>;
    if (view === "loop") return renderLoop();
    if (view === "request") return renderRequest();
    if (view === "article") return renderArticle();
    if (view === "library") {
      return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>Library</h1><p className="demand-intro">Ideas and articles you save stay with this reading workspace.</p>{pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}{visibleHistory ? renderHistoryPage() : <button type="button" className="demand-text-action" onClick={() => void loadHistoryPage({ scope: "saved" }, null)}>Load saved reading</button>}</main>;
    }
    if (view === "profile") return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>Your publication</h1><p className="demand-intro">{workspace.readerKind === "guest" ? "This private guest workspace stays with this browser. Use Curate in a loop to shape its future reading." : "Your loops and pending work are connected to your Edison account."}</p>{workspace.readerKind === "account" ? <Link className="demand-text-action" href="/?view=profile">Account reading preferences</Link> : null}<section className="demand-profile-card"><strong>{workspace.loops.length}</strong><span>{workspace.loops.length === 1 ? "learning loop" : "learning loops"}</span></section></main>;
    return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>For You</h1><p className="demand-intro">Choose an article. We’ll write it for you.</p>{pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}{visibleHistory ? renderHistoryPage() : <>{renderIdeaRecoveryErrors(combinedIdeas)}{combinedIdeas.length ? <div className="demand-idea-grid">{combinedIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined} saving={ideaSaveBlocked(idea.id)} onOpen={() => void openIdea(idea)} onSave={() => void toggleIdeaSave(idea)} />)}</div> : <section className="demand-empty"><h2>What do you want to learn about?</h2><p>Your loops’ article ideas will appear together here.</p><button type="button" className="demand-primary" onClick={openCreate}>Create loop<ArrowRight /></button></section>}{historyEntry({ scope: "all" })}</>}</main>;
  }

  return (
    <>
      <PulseShell
        loops={workspace?.loops ?? []}
        activeLoopId={view === "home" ? PULSE_FOR_YOU_ID : activeLoopId}
        onSelectLoop={(loop) => loop === PULSE_FOR_YOU_ID ? openWorkspaceView("home") : openLoop(loop)}
        onAddLoop={openCreate}
        onOpenHome={() => openWorkspaceView("home")}
        onOpenLibrary={() => openWorkspaceView("library")}
        onOpenProfile={() => openWorkspaceView("profile")}
        onOpenCurate={openCurate}
        showLoopNavigation={view !== "article" && view !== "request"}
        showCurate={view === "loop" || view === "home"}
      >
        {content()}
      </PulseShell>
      <CreateLoopDialog openerRef={createOpenerRef} fallbackRef={readingSurfaceRef} open={createOpen} draft={createDraft} pending={createPending} error={createError} onOpenChange={setCreateOpen} onDraftChange={(draft) => { setCreateDraft(draft); setCreateError(""); if (createAttemptRef.current?.fingerprint !== draft.trim()) createAttemptRef.current = null; }} onSubmit={() => void createLoopAndIdeas()} />
      <CurateLoopDialog openerRef={curateOpenerRef} fallbackRef={readingSurfaceRef} loop={curateLoop} loops={workspace?.loops ?? []} chooseLoop={chooseCurateLoop} onChooseLoop={chooseFeedbackLoop} open={curateOpen} draft={feedbackDraft} pending={feedbackSubmittingLoopId === curateLoop?.id || Boolean(feedbackRequestId && feedbackRequest?.loopId === curateLoop?.id)} error={feedbackError} status={feedbackStatus} onOpenChange={setCurateOpen} onDraftChange={(draft) => { setFeedbackDraft(draft); setFeedbackError(""); if (curateLoop) writeDraft("feedback", curateLoop.id, draft); }} onSubmit={() => void submitFeedback("apply")} onUndo={() => void submitFeedback("undo")} />
      <ArticleQuestionDialog openerRef={askOpenerRef} fallbackRef={readingSurfaceRef} open={askOpen && view === "article"} article={selectedArticle} draft={question} answer={answer}
        pending={Boolean(selectedIdeaId && (questionSubmittingIdeaId === selectedIdeaId || (questionRequestId && questionRequest?.ideaId === selectedIdeaId)))}
        status={requestStage(questionRequest?.stage ?? "queued")} error={pageError} loadFailed={answerLoadFailed}
        onOpenChange={setAskOpen} onDraftChange={(draft) => { setQuestion(draft); if (selectedIdeaId) writeDraft("question", selectedIdeaId, draft); }}
        onSubmit={(event) => void submitQuestion(event)} onLoadAgain={() => { setAnswerLoadFailed(false); setAnswerLoadNonce((value) => value + 1); }} />
    </>
  );
}
