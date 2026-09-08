"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowUp, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAX_CREATION_LENGTH,
  MAX_DIRECTION_LENGTH,
  MIN_DIRECTION_LENGTH,
  type PublicationDirection,
  type PublicationOperationResult,
} from "@/lib/publication-state";

export type EditorialSection = "news" | "books" | "podcasts";
export type EditorialScope = "persistent" | "edition";

export const editorialSections: Record<EditorialSection, {
  label: string;
  placeholder: string;
  work: string;
  article: string;
  creationPlaceholder: string;
}> = {
  news: {
    label: "News",
    placeholder: "More economic history, less startup news…",
    work: "article",
    article: "an",
    creationPlaceholder: "What would you like to read about?",
  },
  books: {
    label: "Books",
    placeholder: "Short books on history and architecture…",
    work: "book",
    article: "a",
    creationPlaceholder: "What would you like a book to explore?",
  },
  podcasts: {
    label: "Podcasts",
    placeholder: "More science. Episodes under 30 minutes…",
    work: "podcast",
    article: "a",
    creationPlaceholder: "What would you like to listen to?",
  },
};

// Some IMEs (notably Safari) end composition before delivering the confirming
// Enter. Checking only KeyboardEvent.isComposing can submit unfinished intent.
export function isCompositionEnter(
  composing: boolean,
  nativeComposing: boolean,
  keyCode: number,
  endedAt: number | null,
  now: number,
) {
  const sinceComposition = endedAt === null ? null : now - endedAt;
  return composing || nativeComposing || keyCode === 229 ||
    (sinceComposition !== null && sinceComposition >= 0 && sinceComposition < 150);
}

function useGrowingTextarea(
  value: string,
  open = true,
) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const resize = () => {
      const element = input.current;
      if (!element) return;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const maximum = Math.max(52, Math.min(260, height * 0.32));
      element.style.height = "auto";
      element.style.height = `${Math.max(52, Math.min(element.scrollHeight, maximum))}px`;
      element.style.overflowY = element.scrollHeight > maximum ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [input, value, open]);
  return input;
}

/** Keep a modal inside the actual keyboard-reduced viewport, including iOS. */
export function useEditorialDialogViewport(
  open: boolean,
) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      const element = content.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      element.style.maxHeight = `${Math.max(120, height - 32)}px`;
      element.style.top = `${(viewport?.offsetTop ?? 0) + height / 2}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [content, open]);
  return content;
}

function useComposerSubmission({
  value,
  pending,
  disabled,
  minimumLength = 1,
  maximumLength,
  onSubmit,
}: {
  value: string;
  pending: boolean;
  disabled: boolean;
  minimumLength?: number;
  maximumLength: number;
  onSubmit: () => void | Promise<unknown>;
}) {
  const [composing, setComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");
  const composition = useRef(false);
  const compositionEndedAt = useRef<number | null>(null);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = useCallback(() => {
    const length = value.trim().length;
    if (length < minimumLength || length > maximumLength || pending || disabled || composition.current || submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    setFailure("");
    // Promise.resolve().then also catches a synchronous callback failure.
    void Promise.resolve().then(onSubmit).catch(() => {
      if (mounted.current) setFailure("The request could not be confirmed. Your draft is still here. Review its status before trying again.");
    }).finally(() => {
      submissionLock.current = false;
      if (mounted.current) setSubmitting(false);
    });
  }, [value, pending, disabled, minimumLength, maximumLength, onSubmit]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    const native = event.nativeEvent;
    if (isCompositionEnter(composition.current, native.isComposing, native.keyCode, compositionEndedAt.current, Date.now())) {
      // Do not cancel a native composition confirmation. A post-composition
      // Enter is consumed so it cannot become a separate submit or newline.
      if (!composition.current && !native.isComposing && native.keyCode !== 229) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (!event.repeat) submit();
  }

  return {
    submit,
    failure,
    clearFailure: () => setFailure(""),
    busy: pending || submitting,
    sendDisabled: value.trim().length < minimumLength || value.trim().length > maximumLength || pending || submitting || disabled || composing,
    textHandlers: {
      onKeyDown,
      onCompositionStart: () => {
        composition.current = true;
        compositionEndedAt.current = null;
        setComposing(true);
      },
      onCompositionEnd: () => {
        composition.current = false;
        compositionEndedAt.current = Date.now();
        setComposing(false);
      },
    },
  };
}

export interface EditorialComposerProps {
  section: EditorialSection;
  value: string;
  scope: EditorialScope;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  status?: string;
  onChange: (value: string) => void;
  onScopeChange: (scope: EditorialScope) => void;
  onSubmit: () => void | Promise<unknown>;
  onReview: () => void;
}

export function EditorialComposer({
  section, value, scope, pending, disabled = false, error, status,
  onChange, onScopeChange, onSubmit, onReview,
}: EditorialComposerProps) {
  const id = useId();
  const input = useGrowingTextarea(value);
  const config = editorialSections[section];
  const submission = useComposerSubmission({
    value,
    pending,
    disabled,
    minimumLength: MIN_DIRECTION_LENGTH,
    maximumLength: MAX_DIRECTION_LENGTH,
    onSubmit,
  });
  const displayedError = error || submission.failure;

  return (
    <section className="editorial-steering" aria-label={`${config.label} editorial direction`}>
      <div className="editorial-composer-heading">
        <label htmlFor={`${id}-input`}>Ask Edison</label>
        <button className="editorial-text-action" type="button" onClick={onReview}>Editorial direction</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); submission.submit(); }} aria-busy={submission.busy}>
        <div className="editorial-composer">
          <textarea
            id={`${id}-input`}
            ref={input}
            rows={2}
            minLength={MIN_DIRECTION_LENGTH}
            maxLength={MAX_DIRECTION_LENGTH}
            className="editorial-composer-input"
            value={value}
            placeholder={config.placeholder}
            aria-describedby={`${id}-hint${displayedError ? ` ${id}-error` : ""}`}
            aria-invalid={Boolean(displayedError)}
            aria-disabled={submission.busy || disabled}
            readOnly={submission.busy || disabled}
            onChange={(event) => { submission.clearFailure(); onChange(event.target.value); }}
            {...submission.textHandlers}
          />
          <div className="editorial-composer-footer">
            <div className="editorial-scope">
              <span>{config.label}<span aria-hidden="true"> ·</span></span>
              <select
                aria-label={`How long should this ${config.label} direction apply?`}
                value={scope}
                disabled={submission.busy || disabled}
                onChange={(event) => onScopeChange(event.target.value as EditorialScope)}
              >
                <option value="persistent">From now on</option>
                <option value="edition">This edition only</option>
              </select>
            </div>
            <button className="editorial-send" type="submit" disabled={submission.sendDisabled} aria-label={`Send ${config.label} direction to Edison`}>
              <ArrowUp aria-hidden="true" size={20} />
            </button>
          </div>
        </div>
        <p className="editorial-hint" id={`${id}-hint`}>Your AI editor. Tell it what you’d like more or less of. Up to {MAX_DIRECTION_LENGTH.toLocaleString()} characters.</p>
        <div className="editorial-composer-status" role="status" aria-live="polite" aria-atomic="true">
          {submission.busy ? `Saving ${config.label} direction…` : status}
        </div>
        {displayedError && <p className="editorial-error" role="alert" id={`${id}-error`}>{displayedError}</p>}
      </form>
    </section>
  );
}

export interface OneOffComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: EditorialSection;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<unknown>;
  pending: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  error?: string;
  status?: string;
}

export function OneOffComposer({
  open, onOpenChange, section, value, onChange, onSubmit, pending,
  disabled = false, unavailableReason, error, status,
}: OneOffComposerProps) {
  const id = useId();
  const input = useGrowingTextarea(value, open);
  const content = useEditorialDialogViewport(open);
  const returnFocus = useRef<HTMLElement | null>(null);
  const config = editorialSections[section];
  const submission = useComposerSubmission({
    value,
    pending,
    disabled: disabled || Boolean(unavailableReason),
    minimumLength: 2,
    maximumLength: MAX_CREATION_LENGTH,
    onSubmit,
  });
  const displayedError = error || submission.failure;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="editorial-dialog editorial-oneoff"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          input.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
          }
        }}
      >
        <div className="editorial-dialog-heading">
          <DialogTitle>Create {config.article} {config.work}</DialogTitle>
          <DialogClose type="button" className="editorial-close" aria-label={`Close ${config.work} composer`}><X aria-hidden="true" size={20} /></DialogClose>
        </div>
        <DialogDescription>One piece for {config.label}. Your editorial direction stays the same.</DialogDescription>
        <form className="editorial-oneoff-form" onSubmit={(event) => { event.preventDefault(); submission.submit(); }} aria-busy={submission.busy}>
          <div className="editorial-dialog-scroll">
            <label className="editorial-field-label" htmlFor={`${id}-input`}>What should this {config.work} be about?</label>
            <textarea
              id={`${id}-input`}
              ref={input}
              className="editorial-oneoff-input"
              rows={3}
              minLength={2}
              maxLength={MAX_CREATION_LENGTH}
              value={value}
              placeholder={config.creationPlaceholder}
              readOnly={submission.busy || disabled}
              aria-invalid={Boolean(displayedError)}
              aria-disabled={submission.busy || disabled}
              aria-describedby={`${id}-hint${unavailableReason ? ` ${id}-unavailable` : ""}${displayedError ? ` ${id}-error` : ""}`}
              onChange={(event) => { submission.clearFailure(); onChange(event.target.value); }}
              {...submission.textHandlers}
            />
            <p id={`${id}-hint`} className="editorial-hint">Enter to send. Shift+Enter for a new line. Closing keeps your draft. Up to {MAX_CREATION_LENGTH.toLocaleString()} characters.</p>
            {unavailableReason && <p className="editorial-dependency" id={`${id}-unavailable`}>{unavailableReason}</p>}
            <div role="status" aria-live="polite" aria-atomic="true" className="editorial-composer-status">{submission.busy ? `Submitting your ${config.work} request…` : status}</div>
            {displayedError && <p className="editorial-error" role="alert" id={`${id}-error`}>{displayedError}</p>}
          </div>
          <div className="editorial-dialog-actions">
            <DialogClose type="button" className="editorial-text-action">Keep draft and close</DialogClose>
            <button type="submit" className="editorial-create-submit" disabled={submission.sendDisabled}>
              {submission.busy ? "Submitting…" : `Create ${config.article} ${config.work}`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface LearnedEditorialInterest {
  id: string;
  label: string;
}

export function GuestDirectionImportDialog({
  open,
  onOpenChange,
  instructions,
  draftCount,
  conflictingDraftCount,
  pending,
  error,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instructions: PublicationDirection[];
  draftCount: number;
  conflictingDraftCount: number;
  pending: boolean;
  error?: string;
  onImport: () => void | Promise<void>;
}) {
  const content = useEditorialDialogViewport(open);
  const returnFocus = useRef<HTMLElement | null>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const editionOnly = instructions.filter((item) => item.scope === "edition").length;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent
        ref={content}
        className="editorial-dialog editorial-guest-import"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
          event.preventDefault();
          importButton.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
          }
        }}
      >
        <div className="editorial-dialog-heading">
          <DialogTitle>Bring over your guest direction?</DialogTitle>
          <DialogClose type="button" className="editorial-close" aria-label="Keep guest direction on this device and close" disabled={pending}>
            <X aria-hidden="true" size={20} />
          </DialogClose>
        </div>
        <DialogDescription>
          Edison found notes saved before you signed in. Importing adds them to
          this account; it does not replace account instructions or start a
          writing job.
        </DialogDescription>
        <div className="editorial-dialog-scroll">
          {instructions.length > 0 && (
            <ul className="editorial-instruction-list">
              {instructions.map((instruction) => (
                <li className="editorial-instruction" key={`${instruction.section}-${instruction.id}`}>
                  <p className="editorial-instruction-text">{instruction.text}</p>
                  <p className="editorial-instruction-scope">
                    {editorialSections[instruction.section].label} · {instruction.scope === "persistent" ? "From now on" : "Guest edition only"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {draftCount > 0 && (
            <p className="editorial-persistence-label">
              {draftCount} unsent {draftCount === 1 ? "draft" : "drafts"} will
              be copied only where the account has no draft in that section.
            </p>
          )}
          {conflictingDraftCount > 0 && (
            <p className="editorial-dependency">
              {conflictingDraftCount} guest {conflictingDraftCount === 1 ? "draft differs" : "drafts differ"} from an account draft. Importing leaves both copies untouched so nothing is overwritten.
            </p>
          )}
          {editionOnly > 0 && (
            <p className="editorial-dependency">
              {editionOnly} guest-edition {editionOnly === 1 ? "instruction" : "instructions"} will target the account&apos;s current matching edition.
            </p>
          )}
          {error && <p className="editorial-error" role="alert">{error}</p>}
        </div>
        <div className="editorial-dialog-actions">
          <DialogClose type="button" className="editorial-text-action" disabled={pending}>Not now</DialogClose>
          <button ref={importButton} type="button" className="editorial-create-submit" disabled={pending} onClick={() => void onImport()}>
            {pending ? "Importing…" : "Add to my account"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type EditorialMutationOutcome =
  | PublicationOperationResult
  | { ok: boolean; message?: string }
  | string
  | void;

export interface EditorialDirectionReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: EditorialSection;
  onSectionChange: (section: EditorialSection) => void;
  instructions: PublicationDirection[];
  learnedInterests?: LearnedEditorialInterest[];
  pending?: boolean;
  hydrated?: boolean;
  persistenceLabel?: string;
  unavailableReason?: string;
  error?: string;
  status?: string;
  editionLabel?: (editionId: string) => string;
  onEdit: (instruction: PublicationDirection, text: string) => EditorialMutationOutcome | Promise<EditorialMutationOutcome>;
  onRemove: (instruction: PublicationDirection) => EditorialMutationOutcome | Promise<EditorialMutationOutcome>;
  onRemoveLearnedInterest?: (interest: LearnedEditorialInterest) => EditorialMutationOutcome | Promise<EditorialMutationOutcome>;
}

function mutationMessage(result: EditorialMutationOutcome): { ok: boolean; message: string } {
  if (result === undefined) return { ok: true, message: "Change saved." };
  if (typeof result === "string") return { ok: true, message: result };
  return {
    ok: result.ok,
    message: result.message || (result.ok ? "Change saved." : "That change could not be saved. Your other directions are unchanged."),
  };
}

function directionScopeLabel(
  instruction: PublicationDirection,
  editionLabel?: (editionId: string) => string,
) {
  if (instruction.scope === "persistent") return "From now on";
  if (instruction.activeForCurrentEdition === false) return "Past edition · no longer active";
  if (!instruction.editionId) return "This edition only";
  return `This edition only · ${editionLabel?.(instruction.editionId) ?? instruction.editionId}`;
}

type ReviewMessage = { tone: "status" | "error"; text: string };
type DirectionEdit = { instruction: PublicationDirection; text: string };

/**
 * Review is deliberately a controlled view over the durable store. It passes
 * the original instruction (including its revision) back for every mutation,
 * so the owner can reject stale edits instead of overwriting a newer change.
 */
export function EditorialDirectionReview({
  open,
  onOpenChange,
  section,
  onSectionChange,
  instructions,
  learnedInterests = [],
  pending = false,
  hydrated = true,
  persistenceLabel,
  unavailableReason,
  error,
  status,
  editionLabel,
  onEdit,
  onRemove,
  onRemoveLearnedInterest,
}: EditorialDirectionReviewProps) {
  const id = useId();
  const content = useEditorialDialogViewport(open);
  const sectionSelect = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  const [edit, setEdit] = useState<DirectionEdit | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<PublicationDirection | null>(null);
  const [interestCandidate, setInterestCandidate] = useState<LearnedEditorialInterest | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationOwner, setMutationOwner] = useState<EditorialSection | null>(null);
  const [messages, setMessages] = useState<Partial<Record<EditorialSection, ReviewMessage>>>({});
  const editInput = useGrowingTextarea(edit?.text ?? "", open && Boolean(edit));
  const editingInstructionId = edit?.instruction.id;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (editingInstructionId) editInput.current?.focus({ preventScroll: true });
  }, [editingInstructionId, editInput]);

  const sectionInstructions = instructions.filter((instruction) => instruction.section === section);
  const locked = pending || mutationPending || Boolean(unavailableReason) || !hydrated;
  const sectionMessage = messages[section];
  const reviewError = error || (sectionMessage?.tone === "error" ? sectionMessage.text : "");

  const runMutation = useCallback(async (
    owner: EditorialSection,
    mutate: () => EditorialMutationOutcome | Promise<EditorialMutationOutcome>,
    onSuccess: () => void,
  ) => {
    if (mutationLock.current || pending || unavailableReason || !hydrated) return;
    mutationLock.current = true;
    setMutationPending(true);
    setMutationOwner(owner);
    setMessages((current) => ({ ...current, [owner]: undefined }));
    try {
      const result = mutationMessage(await mutate());
      if (!mounted.current) return;
      setMessages((current) => ({
        ...current,
        [owner]: { tone: result.ok ? "status" : "error", text: result.message },
      }));
      if (result.ok) onSuccess();
    } catch {
      if (mounted.current) {
        setMessages((current) => ({
          ...current,
          [owner]: { tone: "error", text: "That change could not be confirmed. Nothing else was removed or replaced." },
        }));
      }
    } finally {
      mutationLock.current = false;
      if (mounted.current) {
        setMutationPending(false);
        setMutationOwner(null);
      }
    }
  }, [hydrated, pending, unavailableReason]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="editorial-dialog editorial-direction-review"
        showCloseButton={false}
        aria-describedby={`${id}-description`}
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          sectionSelect.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
          }
        }}
      >
        <div className="editorial-dialog-heading">
          <DialogTitle>Editorial direction</DialogTitle>
          <DialogClose type="button" className="editorial-close" aria-label="Close editorial direction"><X aria-hidden="true" size={20} /></DialogClose>
        </div>
        <DialogDescription id={`${id}-description`}>Review what Edison remembers for each part of your publication.</DialogDescription>

        <div className="editorial-review-section-picker">
          <label htmlFor={`${id}-section`}>Publication section</label>
          <select
            id={`${id}-section`}
            ref={sectionSelect}
            value={section}
            onChange={(event) => onSectionChange(event.target.value as EditorialSection)}
          >
            {(Object.keys(editorialSections) as EditorialSection[]).map((key) => (
              <option key={key} value={key}>{editorialSections[key].label}</option>
            ))}
          </select>
        </div>

        <div className="editorial-dialog-scroll">
          {persistenceLabel && <p className="editorial-persistence-label">{persistenceLabel}</p>}
          {!hydrated && <p className="editorial-dependency" role="status">Loading saved editorial direction…</p>}
          {unavailableReason && <p className="editorial-dependency">{unavailableReason}</p>}

          <section className="editorial-review-group" aria-labelledby={`${id}-instructions`}>
            <h3 id={`${id}-instructions`}>Your instructions</h3>
            {sectionInstructions.length === 0 ? (
              <p className="editorial-empty">No {editorialSections[section].label} instructions saved.</p>
            ) : (
              <ul className="editorial-instruction-list">
                {sectionInstructions.map((instruction) => {
                  const isEditing = edit?.instruction.id === instruction.id && edit.instruction.section === instruction.section;
                  const isRemoving = removeCandidate?.id === instruction.id && removeCandidate.section === instruction.section;
                  const isInactiveEdition = instruction.scope === "edition" && instruction.activeForCurrentEdition === false;
                  return (
                    <li key={instruction.id} className="editorial-instruction">
                      {isEditing && edit ? (
                        <form onSubmit={(event) => {
                          event.preventDefault();
                          if (edit.text.trim().length < MIN_DIRECTION_LENGTH || edit.text.trim().length > MAX_DIRECTION_LENGTH || locked) return;
                          void runMutation(edit.instruction.section, () => onEdit(edit.instruction, edit.text.trim()), () => setEdit(null));
                        }}>
                          <label htmlFor={`${id}-edit-${instruction.id}`}>Edit {editorialSections[instruction.section].label} instruction</label>
                          <textarea
                            id={`${id}-edit-${instruction.id}`}
                            ref={editInput}
                            rows={3}
                            minLength={MIN_DIRECTION_LENGTH}
                            maxLength={MAX_DIRECTION_LENGTH}
                            value={edit.text}
                            disabled={locked}
                            aria-invalid={Boolean(reviewError)}
                            aria-describedby={`${id}-scope-${instruction.id}${reviewError ? ` ${id}-error` : ""}`}
                            onChange={(event) => setEdit({ ...edit, text: event.target.value })}
                          />
                          <p id={`${id}-scope-${instruction.id}`} className="editorial-instruction-scope">{directionScopeLabel(edit.instruction, editionLabel)}</p>
                          <div className="editorial-inline-actions">
                            <button type="button" className="editorial-text-action" disabled={mutationPending} onClick={() => setEdit(null)}>Cancel</button>
                            <button type="submit" className="editorial-save-direction" disabled={locked || edit.text.trim().length < MIN_DIRECTION_LENGTH || edit.text.trim().length > MAX_DIRECTION_LENGTH}>Save instruction</button>
                          </div>
                        </form>
                      ) : isRemoving ? (
                        <div className="editorial-remove-confirmation">
                          <p><strong>Remove this {editorialSections[instruction.section].label} instruction?</strong></p>
                          <blockquote>{removeCandidate.text}</blockquote>
                          <p>Saved reading and the rest of your editorial direction will stay intact.</p>
                          <div className="editorial-inline-actions">
                            <button type="button" className="editorial-text-action" disabled={mutationPending} onClick={() => setRemoveCandidate(null)}>Keep instruction</button>
                            <button
                              type="button"
                              className="editorial-remove-direction"
                              disabled={locked}
                              onClick={() => void runMutation(removeCandidate.section, () => onRemove(removeCandidate), () => setRemoveCandidate(null))}
                            >Remove instruction</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="editorial-instruction-text">{instruction.text}</p>
                          <p className="editorial-instruction-scope">{editorialSections[instruction.section].label} · {directionScopeLabel(instruction, editionLabel)}</p>
                          <div className="editorial-inline-actions">
                            {!isInactiveEdition && <button type="button" className="editorial-text-action" disabled={locked} onClick={() => { setRemoveCandidate(null); setEdit({ instruction, text: instruction.text }); }}>Edit</button>}
                            <button type="button" className="editorial-text-action editorial-destructive-action" disabled={locked} onClick={() => { setEdit(null); setRemoveCandidate(instruction); }}>Remove</button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="editorial-review-group" aria-labelledby={`${id}-interests`}>
            <h3 id={`${id}-interests`}>Learned interests</h3>
            {learnedInterests.length === 0 ? (
              <p className="editorial-empty">No learned interests are available to review.</p>
            ) : (
              <ul className="editorial-interest-list">
                {learnedInterests.map((interest) => {
                  const confirming = interestCandidate?.id === interest.id;
                  return (
                    <li key={interest.id} className="editorial-interest">
                      <span>{interest.label}</span>
                      {confirming ? (
                        <div className="editorial-inline-actions">
                          <span>Remove this learned interest only?</span>
                          <button type="button" className="editorial-text-action" disabled={mutationPending} onClick={() => setInterestCandidate(null)}>Keep</button>
                          <button
                            type="button"
                            className="editorial-text-action editorial-destructive-action"
                            disabled={locked || !onRemoveLearnedInterest}
                            onClick={() => {
                              if (!onRemoveLearnedInterest) return;
                              void runMutation(section, () => onRemoveLearnedInterest(interest), () => setInterestCandidate(null));
                            }}
                          >Remove interest</button>
                        </div>
                      ) : onRemoveLearnedInterest ? (
                        <button type="button" className="editorial-text-action" disabled={locked} onClick={() => setInterestCandidate(interest)}>Remove</button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="editorial-review-announcement" aria-live="polite" aria-atomic="true">
            {pending
              ? `Saving ${editorialSections[section].label} direction…`
              : mutationPending && mutationOwner === section
                ? `Saving ${editorialSections[section].label} direction…`
                : status || (sectionMessage?.tone === "status" ? sectionMessage.text : "")}
          </div>
          {reviewError && (
            <p className="editorial-error" role="alert" id={`${id}-error`}>{reviewError}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
