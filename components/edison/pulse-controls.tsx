"use client";

import { useId, useRef, type RefObject } from "react";
import { ArrowUp, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditorialDialogViewport } from "@/components/edison/editorial-composer";
import type { PulseLoopNavItem } from "@/components/edison/pulse-shell";

const MAX_DIRECTION_LENGTH = 1_000;
const MAX_CURIOSITY_LENGTH = 500;

type PulseAction = () => void | Promise<void>;

export interface PulseDirectionHistoryItem {
  id: string;
  previousDirection: string;
  direction: string;
  createdAt?: string;
}

export interface CurateDialogProps {
  open: boolean;
  loops: readonly PulseLoopNavItem[];
  selectedLoopId: string | null;
  draftText: string;
  currentDirection: string;
  history: readonly PulseDirectionHistoryItem[];
  lastMutationId?: string | null;
  pending?: boolean;
  error?: string;
  status?: string;
  requireLoopSelection?: boolean;
  localOnly?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSelectLoop: (loopId: string) => void;
  onDraftChange: (text: string) => void;
  onSubmit: PulseAction;
  onUndo: (mutationId: string) => void | Promise<void>;
}

function DialogHeading({ title, closeLabel }: { title: string; closeLabel: string }) {
  return (
    <div className="pulse-dialog-heading">
      <DialogTitle>{title}</DialogTitle>
      <DialogClose type="button" className="pulse-dialog-close" aria-label={closeLabel}>
        <X aria-hidden="true" />
      </DialogClose>
    </div>
  );
}

export function CurateDialog({
  open,
  loops,
  selectedLoopId,
  draftText,
  currentDirection,
  history,
  lastMutationId = null,
  pending = false,
  error = "",
  status = "",
  requireLoopSelection = false,
  localOnly = false,
  returnFocusRef,
  onOpenChange,
  onSelectLoop,
  onDraftChange,
  onSubmit,
  onUndo,
}: CurateDialogProps) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const content = useEditorialDialogViewport(open);
  const selectedLoop = loops.find((loop) => loop.id === selectedLoopId);
  const undoItem = lastMutationId
    ? history.find((item) => item.id === lastMutationId)
    : undefined;
  const trimmedLength = draftText.trim().length;
  const clearingDirection = trimmedLength === 0 && currentDirection.trim().length > 0;
  const submitDisabled = pending || !selectedLoop || trimmedLength > MAX_DIRECTION_LENGTH || (trimmedLength === 0 && !clearingDirection);
  const describedBy = [
    `${id}-description`,
    `${id}-direction-note`,
    error ? `${id}-error` : "",
  ].filter(Boolean).join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="pulse-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-description`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (requireLoopSelection ? select.current : textarea.current)?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          const returnTarget = returnFocusRef?.current;
          if (!returnTarget?.isConnected) return;
          event.preventDefault();
          returnTarget.focus({ preventScroll: true });
        }}
      >
        <DialogHeading title="Curate your reading" closeLabel="Close Curate" />
        <DialogDescription id={`${id}-description`}>
          Tell Edison what you’d like more of, less of, or what to explore next.
        </DialogDescription>

        <form
          className="pulse-dialog-form"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitDisabled) void onSubmit();
          }}
        >
          {requireLoopSelection ? (
            <div className="pulse-field">
              <label htmlFor={`${id}-loop`}>Learning loop</label>
              <select
                id={`${id}-loop`}
                ref={select}
                required
                value={selectedLoopId ?? ""}
                disabled={pending}
                onChange={(event) => onSelectLoop(event.target.value)}
              >
                <option value="">Choose a loop</option>
                {loops.map((loop) => (
                  <option key={loop.id} value={loop.id} disabled={loop.paused}>
                    {loop.title}{loop.paused ? " (paused)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="pulse-dialog-target">
              {selectedLoop ? `Updating ${selectedLoop.title}` : "Choose a loop before saving."}
            </p>
          )}

          <div className="pulse-saved-direction" aria-labelledby={`${id}-current-direction`}>
            <h3 id={`${id}-current-direction`}>Current direction</h3>
            <p>{currentDirection || "No direction saved yet."}</p>
          </div>

          <div className="pulse-field">
            <label htmlFor={`${id}-direction`}>
              {selectedLoop ? `What should your ${selectedLoop.title} loop focus on?` : "Choose a loop to start."}
            </label>
            <div className="pulse-composer">
              <textarea
                id={`${id}-direction`}
                ref={textarea}
                rows={3}
                maxLength={MAX_DIRECTION_LENGTH}
                value={draftText}
                readOnly={pending}
                disabled={!selectedLoop}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                placeholder={selectedLoop
                  ? "More historical context. Less introductory explanation."
                  : "Select a learning loop above."}
                onChange={(event) => onDraftChange(event.target.value)}
              />
              <div className="pulse-composer-footer">
                <span aria-live="polite" className="pulse-character-count">
                  {trimmedLength > MAX_DIRECTION_LENGTH ? `${trimmedLength}/${MAX_DIRECTION_LENGTH}` : ""}
                </span>
                <button type="submit" className="pulse-primary-action" disabled={submitDisabled}>
                  <span>{pending ? "Saving…" : clearingDirection ? "Clear direction" : "Update loop"}</span>
                  <ArrowUp aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </form>

        <p className="pulse-dialog-note" id={`${id}-direction-note`}>
          {localOnly
            ? "Saved on this device. Guest directions do not change article selections."
            : `Applies to future scheduled reading in ${selectedLoop?.title ?? "the selected loop"}. Existing articles stay as they are.`}
        </p>

        {status && !error ? <p className="pulse-dialog-status" role="status">{status}</p> : null}
        {error ? <p className="pulse-dialog-error" role="alert" id={`${id}-error`}>{error}</p> : null}

        <section className="pulse-direction-history" aria-labelledby={`${id}-history-title`}>
          <div className="pulse-history-heading">
            <h3 id={`${id}-history-title`}>Direction history</h3>
            {undoItem ? (
              <button
                type="button"
                className="pulse-undo-action"
                disabled={pending}
                onClick={() => void onUndo(undoItem.id)}
              >
                <RotateCcw aria-hidden="true" />
                <span>Undo last change</span>
              </button>
            ) : null}
          </div>
          {history.length > 0 ? (
            <ol>
              {history.map((item) => (
                <li key={item.id}>
                  <p>{item.direction || "No saved direction"}</p>
                  <span>Previously: {item.previousDirection || "No saved direction"}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="pulse-history-empty">No earlier direction changes.</p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

export interface NewLoopDialogProps {
  open: boolean;
  draftText: string;
  suggestions: readonly string[];
  pending?: boolean;
  error?: string;
  status?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (text: string) => void;
  onSubmit: PulseAction;
}

export function NewLoopDialog({
  open,
  draftText,
  suggestions,
  pending = false,
  error = "",
  status = "",
  returnFocusRef,
  onOpenChange,
  onDraftChange,
  onSubmit,
}: NewLoopDialogProps) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const content = useEditorialDialogViewport(open);
  const trimmedLength = draftText.trim().length;
  const submitDisabled = pending || trimmedLength === 0 || trimmedLength > MAX_CURIOSITY_LENGTH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="pulse-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-description`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          const returnTarget = returnFocusRef?.current;
          if (!returnTarget?.isConnected) return;
          event.preventDefault();
          returnTarget.focus({ preventScroll: true });
        }}
      >
        <DialogHeading title="Start a learning loop" closeLabel="Close new loop" />
        <DialogDescription id={`${id}-description`}>
          What’s something you want to learn more about?
        </DialogDescription>

        <form
          className="pulse-dialog-form"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitDisabled) void onSubmit();
          }}
        >
          <div className="pulse-field">
            <label htmlFor={`${id}-curiosity`}>A topic or a question</label>
            <div className="pulse-composer">
              <textarea
                id={`${id}-curiosity`}
                ref={textarea}
                rows={3}
                maxLength={MAX_CURIOSITY_LENGTH}
                required
                value={draftText}
                readOnly={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={`${id}-availability${error ? ` ${id}-error` : ""}`}
                placeholder="How do great cities get built?"
                onChange={(event) => onDraftChange(event.target.value)}
              />
              <div className="pulse-composer-footer">
                <span aria-live="polite" className="pulse-character-count">
                  {trimmedLength > MAX_CURIOSITY_LENGTH ? `${trimmedLength}/${MAX_CURIOSITY_LENGTH}` : ""}
                </span>
                <button type="submit" className="pulse-primary-action" disabled={submitDisabled}>
                  <span>{pending ? "Creating…" : "Create loop"}</span>
                  <ArrowUp aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </form>

        {suggestions.length > 0 ? (
          <div className="pulse-suggestions" aria-label="Subjects with reading available now">
            <span>Available now</span>
            <div>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
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
        ) : null}

        <p className="pulse-dialog-note" id={`${id}-availability`}>
          If no prepared article matches, the loop opens empty instead of substituting unrelated reading.
        </p>
        {status && !error ? <p className="pulse-dialog-status" role="status">{status}</p> : null}
        {error ? <p className="pulse-dialog-error" role="alert" id={`${id}-error`}>{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
