import { z } from "zod";

export const PUBLICATION_SECTIONS = ["news", "books", "podcasts"] as const;
export type PublicationSection = (typeof PUBLICATION_SECTIONS)[number];
export type DirectionScope = "persistent" | "edition";
export type PublicationDraftKind = "editorial" | "creation";
export const MIN_DIRECTION_LENGTH = 3;
export const MAX_DIRECTION_LENGTH = 1_000;
export const MAX_CREATION_LENGTH = 500;
export const MAX_PUBLICATION_DRAFT_LENGTH = MAX_DIRECTION_LENGTH;
const MAX_DIRECTIONS_PER_SECTION = 50;
const MAX_STORAGE_LENGTH = 750_000;

const sectionSchema = z.enum(PUBLICATION_SECTIONS);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const directionSchema = z.object({
  id: z.string().min(1).max(160),
  section: sectionSchema,
  scope: z.enum(["persistent", "edition"]),
  editionId: z.string().min(1).max(250).nullable(),
  text: z.string().trim().min(MIN_DIRECTION_LENGTH).max(MAX_DIRECTION_LENGTH),
  revision: revisionSchema,
}).strict().refine((value) => value.scope === "edition" ? value.editionId !== null : value.editionId === null);

export type PublicationDirection = z.infer<typeof directionSchema> & {
  /** Server/current-edition context; never persisted in the device workspace. */
  activeForCurrentEdition?: boolean;
};

const undoSchema = z.object({
  revision: revisionSchema,
  before: directionSchema.nullable(),
  after: directionSchema.nullable(),
  index: z.number().int().nonnegative().max(MAX_DIRECTIONS_PER_SECTION),
}).strict();

const sectionStateSchema = z.object({
  editorialDraft: z.string().max(MAX_DIRECTION_LENGTH),
  creationDraft: z.string().max(MAX_CREATION_LENGTH),
  scope: z.enum(["persistent", "edition"]),
  draftRevisions: z.object({ editorial: revisionSchema, creation: revisionSchema }).strict(),
  scopeRevision: revisionSchema,
  revision: revisionSchema,
  directions: z.array(directionSchema).max(MAX_DIRECTIONS_PER_SECTION),
  undo: undoSchema.nullable(),
}).strict();

const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  namespace: z.string().min(1).max(2_000),
  version: revisionSchema,
  sections: z.object({
    news: sectionStateSchema,
    books: sectionStateSchema,
    podcasts: sectionStateSchema,
  }).strict(),
}).strict();

export type PublicationWorkspace = z.infer<typeof workspaceSchema>;
export type PublicationSectionState = PublicationWorkspace["sections"][PublicationSection];
export type PublicationFailureCode = "not-ready" | "invalid" | "limit" | "pending" | "conflict" | "corrupt" | "storage-unavailable" | "locking-unavailable";
export type PublicationOperationResult = {
  ok: true;
  section: PublicationSection;
  revision: number;
  persistence: "device-local";
  generation: "not-requested";
  message: string;
} | {
  ok: false;
  section: PublicationSection;
  code: PublicationFailureCode;
  message: string;
};

export interface PublicationWorkspaceSnapshot {
  workspace: PublicationWorkspace;
  hydrated: boolean;
  storageError: string | null;
  pending: boolean;
}

export interface PublicationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** All writers must share this exclusive lock; a localStorage read/write pair alone is not atomic. */
export type PublicationExclusiveLock = <T>(operation: () => T | Promise<T>) => Promise<T>;

export interface PublicationStoreOptions {
  identity?: string | null;
  storage: () => PublicationStorage;
  withLock: PublicationExclusiveLock;
  createId?: () => string;
}

const sectionLabel = (section: PublicationSection) => section[0].toUpperCase() + section.slice(1);
const failure = (section: PublicationSection, code: PublicationFailureCode, message: string): PublicationOperationResult => ({ ok: false, section, code, message });

export class PublicationStorageError extends Error {
  constructor(public readonly code: PublicationFailureCode, message: string) {
    super(message);
    this.name = "PublicationStorageError";
  }
}

export function publicationStorageKey(identity?: string | null): string {
  if (identity !== undefined && identity !== null && (identity.length === 0 || identity.length > 120)) {
    throw new Error("A stable account identifier is required for local publication storage.");
  }
  return `edison:publication-workspace:v1:${identity ? `account:${encodeURIComponent(identity)}` : "guest"}`;
}

export function createEmptyPublicationWorkspace(namespace: string): PublicationWorkspace {
  const emptySection = (): PublicationSectionState => ({
    editorialDraft: "", creationDraft: "", scope: "persistent",
    draftRevisions: { editorial: 0, creation: 0 }, scopeRevision: 0,
    revision: 0, directions: [], undo: null,
  });
  return { schemaVersion: 1, namespace, version: 0, sections: { news: emptySection(), books: emptySection(), podcasts: emptySection() } };
}

export function applicablePublicationDirections(workspace: PublicationWorkspace, section: PublicationSection, editionId: string): PublicationDirection[] {
  return workspace.sections[section].directions.filter((direction) => direction.scope === "persistent" || direction.editionId === editionId);
}

function parseWorkspace(raw: string | null, namespace: string): PublicationWorkspace {
  if (raw === null) return createEmptyPublicationWorkspace(namespace);
  try {
    if (raw.length > MAX_STORAGE_LENGTH) throw new Error("Oversized workspace");
    const workspace = workspaceSchema.parse(JSON.parse(raw));
    if (workspace.namespace !== namespace) throw new Error("Mismatched namespace");
    for (const section of PUBLICATION_SECTIONS) {
      const state = workspace.sections[section];
      const ids = new Set<string>();
      for (const direction of state.directions) {
        if (direction.section !== section || direction.revision > state.revision || ids.has(direction.id)) throw new Error("Invalid direction ownership");
        ids.add(direction.id);
      }
      if (state.undo) {
        const { before, after, revision } = state.undo;
        if (revision !== state.revision || (!before && !after) || (before && after && before.id !== after.id)) throw new Error("Invalid Undo revision");
        if ([before, after].some((direction) => direction && (direction.section !== section || direction.revision > revision))) throw new Error("Invalid Undo ownership");
      }
    }
    return workspace;
  } catch {
    throw new PublicationStorageError("corrupt", "Saved editorial notes could not be read. They have not been overwritten. Keep a copy of your draft and retry after restoring browser storage.");
  }
}

/** Read a device workspace without mutating, repairing, or claiming ownership of it. */
export function readPublicationWorkspace(
  storage: PublicationStorage,
  identity?: string | null,
): PublicationWorkspace {
  const namespace = publicationStorageKey(identity);
  return parseWorkspace(storage.getItem(namespace), namespace);
}

type DraftOverlay = { text: string; serial: number };
type Mutation = (next: PublicationWorkspace, known: PublicationWorkspace) => void;

/**
 * Device-local notes only. This store never calls generation, edits content, or
 * touches account preferences, playback, reading history, or the saved library.
 * Guest and account namespaces remain separate; there is no implicit merge.
 */
export class PublicationWorkspaceStore {
  readonly storageKey: string;
  private durable: PublicationWorkspace;
  private snapshot: PublicationWorkspaceSnapshot;
  private readonly serverSnapshot: PublicationWorkspaceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly overlays = new Map<string, DraftOverlay>();
  private readonly scopeOverlays = new Map<PublicationSection, { scope: DirectionScope; serial: number }>();
  private serial = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pendingSections = new Set<PublicationSection>();

  constructor(private readonly options: PublicationStoreOptions) {
    this.storageKey = publicationStorageKey(options.identity);
    this.durable = createEmptyPublicationWorkspace(this.storageKey);
    this.snapshot = { workspace: this.durable, hydrated: false, storageError: null, pending: false };
    this.serverSnapshot = this.snapshot;
  }

  getSnapshot = (): PublicationWorkspaceSnapshot => this.snapshot;
  getServerSnapshot = (): PublicationWorkspaceSnapshot => this.serverSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(extra: Partial<Omit<PublicationWorkspaceSnapshot, "workspace">> = {}) {
    const workspace = structuredClone(this.durable);
    for (const section of PUBLICATION_SECTIONS) {
      for (const kind of ["editorial", "creation"] as const) {
        const overlay = this.overlays.get(`${section}:${kind}`);
        if (overlay) workspace.sections[section][`${kind}Draft`] = overlay.text;
      }
      const scope = this.scopeOverlays.get(section);
      if (scope) workspace.sections[section].scope = scope.scope;
    }
    this.snapshot = { ...this.snapshot, ...extra, workspace, pending: this.pendingSections.size > 0 };
    for (const listener of this.listeners) listener();
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Read-only hydration/recovery: never seeds or repairs localStorage implicitly. */
  reload = (): Promise<void> => this.enqueue(() => {
    try {
      this.durable = parseWorkspace(this.options.storage().getItem(this.storageKey), this.storageKey);
      this.publish({ hydrated: true, storageError: null });
    } catch (error) {
      this.publish({ hydrated: true, storageError: this.errorMessage(error) });
    }
  });

  private errorMessage(error: unknown) {
    return error instanceof PublicationStorageError ? error.message : "Browser storage is unavailable. Your draft is still here, but it has not been saved on this device.";
  }

  private conflict(): never {
    throw new PublicationStorageError("conflict", "Your editorial workspace changed in another tab or since this edit. Your draft is still here. Reload saved notes and review before trying again.");
  }

  private mutate(section: PublicationSection, mutation: Mutation, message: string, afterSave?: () => void): Promise<PublicationOperationResult> {
    return this.enqueue(async () => {
      if (!this.snapshot.hydrated) return failure(section, "not-ready", "Your saved notes are still loading. Your draft has not been submitted.");
      try {
        return await this.options.withLock(() => {
          const storage = this.options.storage();
          const raw = storage.getItem(this.storageKey);
          const current = parseWorkspace(raw, this.storageKey);
          const next = structuredClone(current);
          mutation(next, this.durable);
          next.version += 1;
          if (!workspaceSchema.safeParse(next).success) {
            throw new PublicationStorageError("limit", "This change exceeds the safe limits for a device-local editorial workspace.");
          }
          const serialized = JSON.stringify(next);
          if (serialized.length > MAX_STORAGE_LENGTH) throw new PublicationStorageError("limit", "This device's editorial workspace is full. Remove an old instruction before saving more.");
          // The lock serializes participating tabs. The raw comparison also
          // rejects changes made outside this store before the write.
          if (storage.getItem(this.storageKey) !== raw) this.conflict();
          storage.setItem(this.storageKey, serialized);
          if (storage.getItem(this.storageKey) !== serialized) this.conflict();
          this.durable = next;
          afterSave?.();
          this.publish({ storageError: null });
          return { ok: true as const, section, revision: next.sections[section].revision, persistence: "device-local" as const, generation: "not-requested" as const, message };
        });
      } catch (error) {
        const code = error instanceof PublicationStorageError ? error.code : "storage-unavailable";
        const message = this.errorMessage(error);
        if (["conflict", "corrupt", "storage-unavailable", "locking-unavailable"].includes(code)) this.publish({ storageError: message });
        return failure(section, code, message);
      }
    });
  }

  updateDraft = (section: PublicationSection, kind: PublicationDraftKind, text: string): Promise<PublicationOperationResult> => {
    const maximum = kind === "editorial" ? MAX_DIRECTION_LENGTH : MAX_CREATION_LENGTH;
    if (text.length > maximum) return Promise.resolve(failure(section, "limit", `Keep this draft under ${maximum.toLocaleString()} characters.`));
    const key = `${section}:${kind}`;
    const serial = ++this.serial;
    this.overlays.set(key, { text, serial });
    this.publish();
    return this.mutate(section, (next, known) => {
      if (next.sections[section].draftRevisions[kind] !== known.sections[section].draftRevisions[kind]) this.conflict();
      next.sections[section][`${kind}Draft`] = text;
      next.sections[section].draftRevisions[kind] += 1;
    }, `${sectionLabel(section)} draft saved on this device.`, () => {
      if (this.overlays.get(key)?.serial === serial) this.overlays.delete(key);
    });
  };

  updateScope = (section: PublicationSection, scope: DirectionScope): Promise<PublicationOperationResult> => {
    const serial = ++this.serial;
    this.scopeOverlays.set(section, { scope, serial });
    this.publish();
    return this.mutate(section, (next, known) => {
      if (next.sections[section].scopeRevision !== known.sections[section].scopeRevision) this.conflict();
      next.sections[section].scope = scope;
      next.sections[section].scopeRevision += 1;
    }, `${sectionLabel(section)} scope saved on this device.`, () => {
      if (this.scopeOverlays.get(section)?.serial === serial) this.scopeOverlays.delete(section);
    });
  };

  private directionMutation(section: PublicationSection, mutation: Mutation, message: string, afterSave?: () => void) {
    if (this.pendingSections.has(section)) return Promise.resolve(failure(section, "pending", "This section's editorial note is already being saved."));
    this.pendingSections.add(section);
    this.publish();
    return this.mutate(section, mutation, message, afterSave).finally(() => {
      this.pendingSections.delete(section);
      this.publish();
    });
  }

  saveDirection = (section: PublicationSection, editionId: string): Promise<PublicationOperationResult> => {
    const visible = this.snapshot.workspace.sections[section];
    const text = visible.editorialDraft.trim();
    const scope = visible.scope;
    const expectedRevision = this.durable.sections[section].revision;
    const overlaySerial = this.overlays.get(`${section}:editorial`)?.serial;
    if (text.length < MIN_DIRECTION_LENGTH || text.length > MAX_DIRECTION_LENGTH) return Promise.resolve(failure(section, "invalid", `Write an editorial instruction of ${MIN_DIRECTION_LENGTH}–${MAX_DIRECTION_LENGTH.toLocaleString()} characters.`));
    if (scope === "edition" && (!editionId.trim() || editionId.length > 250)) return Promise.resolve(failure(section, "invalid", "This edition does not yet have a stable identity. Choose From now on, or try again when an edition is available."));
    return this.directionMutation(section, (next) => {
      const state = next.sections[section];
      if (state.revision !== expectedRevision) this.conflict();
      if (state.directions.length >= MAX_DIRECTIONS_PER_SECTION) throw new PublicationStorageError("limit", `You can keep ${MAX_DIRECTIONS_PER_SECTION} instructions per section. Remove an older instruction first.`);
      state.revision += 1;
      const direction: PublicationDirection = { id: this.options.createId?.() ?? globalThis.crypto.randomUUID(), section, scope, editionId: scope === "edition" ? editionId : null, text, revision: state.revision };
      state.undo = { revision: state.revision, before: null, after: direction, index: state.directions.length };
      state.directions.push(direction);
      // A newer draft is a separate operation, never part of this submission.
      if (state.editorialDraft.trim() === text) {
        state.editorialDraft = "";
        state.draftRevisions.editorial += 1;
      }
    }, `${sectionLabel(section)} direction saved on this device. ${scope === "persistent" ? "From now on" : "This edition only"}. Account sync and editorial generation are not connected; existing content is unchanged.`, () => {
      if (this.overlays.get(`${section}:editorial`)?.serial === overlaySerial) this.overlays.delete(`${section}:editorial`);
    });
  };

  editDirection = (section: PublicationSection, id: string, text: string, expectedInstructionRevision?: number): Promise<PublicationOperationResult> => {
    const cleaned = text.trim();
    if (cleaned.length < MIN_DIRECTION_LENGTH || cleaned.length > MAX_DIRECTION_LENGTH) return Promise.resolve(failure(section, "invalid", `Use ${MIN_DIRECTION_LENGTH}–${MAX_DIRECTION_LENGTH.toLocaleString()} characters for an instruction.`));
    return this.changeDirection(section, id, (before, revision) => ({ ...before, text: cleaned, revision }), "edited", expectedInstructionRevision);
  };

  removeDirection = (section: PublicationSection, id: string, expectedInstructionRevision?: number): Promise<PublicationOperationResult> => this.changeDirection(section, id, () => null, "removed", expectedInstructionRevision);

  private changeDirection(section: PublicationSection, id: string, change: (before: PublicationDirection, revision: number) => PublicationDirection | null, verb: string, expectedInstructionRevision?: number) {
    const expectedRevision = this.durable.sections[section].revision;
    const expectedDirection = this.durable.sections[section].directions.find((direction) => direction.id === id);
    return this.directionMutation(section, (next) => {
      const state = next.sections[section];
      const index = state.directions.findIndex((direction) => direction.id === id);
      const before = state.directions[index];
      if (!before || !expectedDirection || state.revision !== expectedRevision || before.revision !== (expectedInstructionRevision ?? expectedDirection.revision)) this.conflict();
      state.revision += 1;
      const after = change(before, state.revision);
      if (after) state.directions[index] = after;
      else state.directions.splice(index, 1);
      state.undo = { revision: state.revision, before, after, index };
    }, `${sectionLabel(section)} direction ${verb} on this device. Account sync and editorial generation are not connected; reading and saved content are unchanged.`);
  }

  undoDirection = (section: PublicationSection, revision: number): Promise<PublicationOperationResult> => this.directionMutation(section, (next) => {
    const state = next.sections[section];
    const transaction = state.undo;
    if (!transaction || transaction.revision !== revision || state.revision !== revision) this.conflict();
    const id = transaction.after?.id ?? transaction.before!.id;
    const index = state.directions.findIndex((direction) => direction.id === id);
    if (transaction.after && (index < 0 || state.directions[index].revision !== revision)) this.conflict();
    if (!transaction.after && index >= 0) this.conflict();
    state.revision += 1;
    if (index >= 0) state.directions.splice(index, 1);
    if (transaction.before) state.directions.splice(transaction.index, 0, { ...transaction.before, revision: state.revision });
    state.undo = null;
  }, `${sectionLabel(section)} editorial change undone on this device. Reading and saved content are unchanged.`);
}
