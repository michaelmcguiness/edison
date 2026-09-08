import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DIRECTION_LENGTH,
  MAX_CREATION_LENGTH,
  MAX_PUBLICATION_DRAFT_LENGTH,
  PublicationStorageError,
  PublicationWorkspaceStore,
  applicablePublicationDirections,
  createEmptyPublicationWorkspace,
  publicationStorageKey,
  type PublicationExclusiveLock,
  type PublicationStorage,
} from "../lib/publication-state";

class MemoryStorage implements PublicationStorage {
  readonly values = new Map<string, string>();
  readError: Error | null = null;
  writeError: Error | null = null;

  getItem(key: string) {
    if (this.readError) throw this.readError;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.writeError) throw this.writeError;
    this.values.set(key, value);
  }
}

const immediateLock: PublicationExclusiveLock = async (operation) => operation();

function makeStore(
  storage: MemoryStorage,
  options: { identity?: string | null; prefix?: string; withLock?: PublicationExclusiveLock } = {},
) {
  let sequence = 0;
  return new PublicationWorkspaceStore({
    identity: options.identity,
    storage: () => storage,
    withLock: options.withLock ?? immediateLock,
    createId: () => `${options.prefix ?? "direction"}-${++sequence}`,
  });
}

test("workspace is hydration-gated and a read never seeds storage", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);

  assert.equal(store.getSnapshot().hydrated, false);
  assert.equal(storage.values.size, 0);
  const premature = await store.updateDraft("news", "editorial", "Keep this draft");
  assert.deepEqual(premature, {
    ok: false,
    section: "news",
    code: "not-ready",
    message: "Your saved notes are still loading. Your draft has not been submitted.",
  });
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "Keep this draft");
  assert.equal(storage.values.size, 0);

  await store.reload();
  assert.equal(store.getSnapshot().hydrated, true);
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "Keep this draft");
  assert.equal(storage.values.size, 0, "hydration must not write a default document");
});

test("editorial and creation drafts plus scope survive a reload by section", async () => {
  const storage = new MemoryStorage();
  const first = makeStore(storage);
  await first.reload();

  assert.equal((await first.updateDraft("news", "editorial", "More local history")).ok, true);
  assert.equal((await first.updateDraft("news", "creation", "One article about canals")).ok, true);
  assert.equal((await first.updateDraft("books", "editorial", "Short architecture books")).ok, true);
  assert.equal((await first.updateScope("news", "edition")).ok, true);

  const reloaded = makeStore(storage);
  await reloaded.reload();
  const workspace = reloaded.getSnapshot().workspace;
  assert.equal(workspace.sections.news.editorialDraft, "More local history");
  assert.equal(workspace.sections.news.creationDraft, "One article about canals");
  assert.equal(workspace.sections.news.scope, "edition");
  assert.equal(workspace.sections.books.editorialDraft, "Short architecture books");
  assert.equal(workspace.sections.books.creationDraft, "");
  assert.equal(workspace.sections.podcasts.editorialDraft, "");
});

test("guest and signed-in device-local namespaces remain isolated", async () => {
  const storage = new MemoryStorage();
  const guest = makeStore(storage, { prefix: "guest" });
  const account = makeStore(storage, { identity: "reader-123", prefix: "account" });
  await guest.reload();
  await account.reload();

  await guest.updateDraft("news", "editorial", "Guest direction");
  await account.updateDraft("news", "editorial", "Account direction");
  assert.notEqual(guest.storageKey, account.storageKey);
  assert.equal(storage.values.size, 2);

  const guestAgain = makeStore(storage);
  const accountAgain = makeStore(storage, { identity: "reader-123" });
  await guestAgain.reload();
  await accountAgain.reload();
  assert.equal(guestAgain.getSnapshot().workspace.sections.news.editorialDraft, "Guest direction");
  assert.equal(accountAgain.getSnapshot().workspace.sections.news.editorialDraft, "Account direction");
  assert.equal(accountAgain.getSnapshot().workspace.sections.books.directions.length, 0);
});

test("storage keys encode bounded stable identifiers without exposing a raw delimiter", () => {
  assert.equal(publicationStorageKey(), "edison:publication-workspace:v1:guest");
  assert.equal(publicationStorageKey("reader/a:b"), "edison:publication-workspace:v1:account:reader%2Fa%3Ab");
  assert.throws(() => publicationStorageKey(""), /stable account identifier/);
  assert.throws(() => publicationStorageKey("x".repeat(121)), /stable account identifier/);
  assert.doesNotThrow(() => createEmptyPublicationWorkspace(publicationStorageKey("📰".repeat(60))));
});

test("a persistent direction is device-local, section-specific, durable, and does not claim generation", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, { prefix: "news" });
  await store.reload();
  await store.updateDraft("news", "editorial", "More economic history");

  const result = await store.saveDirection("news", "edition-2026-09-04");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.section, "news");
  assert.equal(result.persistence, "device-local");
  assert.equal(result.generation, "not-requested");
  assert.match(result.message, /Account sync and editorial generation are not connected/);

  const state = store.getSnapshot().workspace.sections.news;
  assert.equal(state.editorialDraft, "");
  assert.deepEqual(state.directions, [{
    id: "news-1",
    section: "news",
    scope: "persistent",
    editionId: null,
    text: "More economic history",
    revision: 1,
  }]);
  assert.equal(store.getSnapshot().workspace.sections.books.directions.length, 0);
  assert.equal(store.getSnapshot().workspace.sections.podcasts.directions.length, 0);

  const reloaded = makeStore(storage);
  await reloaded.reload();
  assert.equal(reloaded.getSnapshot().workspace.sections.news.directions[0]?.text, "More economic history");
});

test("edition-only directions remain bound to their stable edition identity", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, { prefix: "temporary" });
  await store.reload();
  await store.updateScope("news", "edition");
  await store.updateDraft("news", "editorial", "Go deeper for this edition");

  const missingEdition = await store.saveDirection("news", "");
  assert.equal(missingEdition.ok, false);
  if (!missingEdition.ok) assert.equal(missingEdition.code, "invalid");
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "Go deeper for this edition");

  const saved = await store.saveDirection("news", "edition-stable-a");
  assert.equal(saved.ok, true);
  const workspace = store.getSnapshot().workspace;
  assert.deepEqual(applicablePublicationDirections(workspace, "news", "edition-stable-a").map((item) => item.text), ["Go deeper for this edition"]);
  assert.deepEqual(applicablePublicationDirections(workspace, "news", "edition-stable-b"), []);
  assert.equal(workspace.sections.news.directions[0]?.editionId, "edition-stable-a");
  assert.equal(workspace.sections.news.directions[0]?.scope, "edition");
});

test("persistent directions apply to later editions but never cross sections", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  await store.reload();
  await store.updateDraft("books", "editorial", "More architectural history");
  await store.saveDirection("books", "books-edition-1");

  const workspace = store.getSnapshot().workspace;
  assert.equal(applicablePublicationDirections(workspace, "books", "books-edition-999").length, 1);
  assert.equal(applicablePublicationDirections(workspace, "news", "books-edition-999").length, 0);
  assert.equal(applicablePublicationDirections(workspace, "podcasts", "books-edition-999").length, 0);
});

test("same-field stale draft writes are rejected while independent section writes merge", async () => {
  const storage = new MemoryStorage();
  const first = makeStore(storage, { prefix: "first" });
  const stale = makeStore(storage, { prefix: "stale" });
  await first.reload();
  await stale.reload();

  assert.equal((await first.updateDraft("news", "editorial", "First tab")).ok, true);
  const conflict = await stale.updateDraft("news", "editorial", "Second tab");
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "conflict");
  assert.equal(stale.getSnapshot().workspace.sections.news.editorialDraft, "Second tab", "losing draft remains recoverable in memory");

  const independent = await stale.updateDraft("books", "editorial", "Book note");
  assert.equal(independent.ok, true, "an unrelated section can merge against the current document");
  const check = makeStore(storage);
  await check.reload();
  assert.equal(check.getSnapshot().workspace.sections.news.editorialDraft, "First tab");
  assert.equal(check.getSnapshot().workspace.sections.books.editorialDraft, "Book note");
});

test("optimistic CAS rejects duplicate direction saves from a stale tab", async () => {
  const storage = new MemoryStorage();
  const first = makeStore(storage, { prefix: "first" });
  await first.reload();
  await first.updateDraft("news", "editorial", "A single logical direction");

  const stale = makeStore(storage, { prefix: "stale" });
  await stale.reload();
  const firstSave = await first.saveDirection("news", "edition-a");
  const duplicate = await stale.saveDirection("news", "edition-a");
  assert.equal(firstSave.ok, true);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, "conflict");
  assert.equal(stale.getSnapshot().workspace.sections.news.editorialDraft, "A single logical direction");

  const check = makeStore(storage);
  await check.reload();
  assert.equal(check.getSnapshot().workspace.sections.news.directions.length, 1);
});

test("edit and remove reject stale instruction revisions", async () => {
  const storage = new MemoryStorage();
  const first = makeStore(storage, { prefix: "id" });
  await first.reload();
  await first.updateDraft("podcasts", "editorial", "Short episodes");
  await first.saveDirection("podcasts", "podcasts-a");
  const original = first.getSnapshot().workspace.sections.podcasts.directions[0]!;

  const stale = makeStore(storage);
  await stale.reload();
  const edited = await first.editDirection("podcasts", original.id, "Short science episodes", original.revision);
  assert.equal(edited.ok, true);
  const removed = await stale.removeDirection("podcasts", original.id, original.revision);
  assert.equal(removed.ok, false);
  if (!removed.ok) assert.equal(removed.code, "conflict");

  const check = makeStore(storage);
  await check.reload();
  assert.equal(check.getSnapshot().workspace.sections.podcasts.directions[0]?.text, "Short science episodes");
});

test("Undo reverses its own latest transaction and persists without touching other sections", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, { prefix: "id" });
  await store.reload();
  await store.updateDraft("news", "editorial", "Original News direction");
  const saved = await store.saveDirection("news", "news-a");
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  await store.updateDraft("books", "creation", "A book request stays here");

  const undone = await store.undoDirection("news", saved.revision);
  assert.equal(undone.ok, true);
  assert.equal(store.getSnapshot().workspace.sections.news.directions.length, 0);
  assert.equal(store.getSnapshot().workspace.sections.books.creationDraft, "A book request stays here");

  const reloaded = makeStore(storage);
  await reloaded.reload();
  assert.equal(reloaded.getSnapshot().workspace.sections.news.directions.length, 0);
  assert.equal(reloaded.getSnapshot().workspace.sections.books.creationDraft, "A book request stays here");
});

test("Undo rejects a superseded revision instead of restoring a global snapshot", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, { prefix: "id" });
  await store.reload();
  await store.updateDraft("news", "editorial", "Original");
  const saved = await store.saveDirection("news", "news-a");
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const direction = store.getSnapshot().workspace.sections.news.directions[0]!;
  const edited = await store.editDirection("news", direction.id, "Subsequent edit", direction.revision);
  assert.equal(edited.ok, true);

  const staleUndo = await store.undoDirection("news", saved.revision);
  assert.equal(staleUndo.ok, false);
  if (!staleUndo.ok) assert.equal(staleUndo.code, "conflict");
  assert.equal(store.getSnapshot().workspace.sections.news.directions[0]?.text, "Subsequent edit");

  if (!edited.ok) return;
  const currentUndo = await store.undoDirection("news", edited.revision);
  assert.equal(currentUndo.ok, true);
  assert.equal(store.getSnapshot().workspace.sections.news.directions[0]?.text, "Original");
  const repeatedUndo = await store.undoDirection("news", edited.revision);
  assert.equal(repeatedUndo.ok, false);
  if (!repeatedUndo.ok) assert.equal(repeatedUndo.code, "conflict");
});

test("corrupt persisted state is reported and never silently overwritten", async () => {
  const storage = new MemoryStorage();
  const key = publicationStorageKey();
  storage.values.set(key, "{not valid json");
  const store = makeStore(storage);
  await store.reload();

  assert.equal(store.getSnapshot().hydrated, true);
  assert.match(store.getSnapshot().storageError ?? "", /could not be read/);
  const original = storage.values.get(key);
  const attempt = await store.updateDraft("news", "editorial", "Recoverable local draft");
  assert.equal(attempt.ok, false);
  if (!attempt.ok) assert.equal(attempt.code, "corrupt");
  assert.equal(storage.values.get(key), original);
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "Recoverable local draft");

  storage.values.set(key, JSON.stringify(createEmptyPublicationWorkspace(key)));
  await store.reload();
  assert.equal(store.getSnapshot().storageError, null);
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "Recoverable local draft", "recovery retains the unsaved overlay");
  assert.equal(JSON.parse(storage.values.get(key)!).sections.news.editorialDraft, "", "recovery itself remains read-only");
});

test("storage read and write denial preserve drafts and never acknowledge persistence", async () => {
  const deniedRead = new MemoryStorage();
  deniedRead.readError = new Error("SecurityError");
  const readStore = makeStore(deniedRead);
  await readStore.reload();
  assert.match(readStore.getSnapshot().storageError ?? "", /unavailable/);
  const readResult = await readStore.updateDraft("news", "editorial", "Visible despite denial");
  assert.equal(readResult.ok, false);
  if (!readResult.ok) assert.equal(readResult.code, "storage-unavailable");
  assert.equal(readStore.getSnapshot().workspace.sections.news.editorialDraft, "Visible despite denial");

  const deniedWrite = new MemoryStorage();
  const writeStore = makeStore(deniedWrite);
  await writeStore.reload();
  deniedWrite.writeError = new Error("QuotaExceededError");
  const writeResult = await writeStore.updateDraft("books", "creation", "Unpersisted book draft");
  assert.equal(writeResult.ok, false);
  if (!writeResult.ok) assert.equal(writeResult.code, "storage-unavailable");
  assert.equal(writeStore.getSnapshot().workspace.sections.books.creationDraft, "Unpersisted book draft");
  assert.equal(deniedWrite.values.size, 0);
});

test("missing exclusive locking rejects writes rather than pretending localStorage CAS is atomic", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, {
    withLock: async () => {
      throw new PublicationStorageError("locking-unavailable", "No safe cross-tab lock is available.");
    },
  });
  await store.reload();
  const result = await store.updateDraft("news", "creation", "Still visible");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "locking-unavailable");
  assert.equal(store.getSnapshot().workspace.sections.news.creationDraft, "Still visible");
  assert.equal(storage.values.size, 0);
});

test("draft and direction inputs are explicitly bounded", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage);
  await store.reload();
  const draft = await store.updateDraft("news", "editorial", "d".repeat(MAX_PUBLICATION_DRAFT_LENGTH + 1));
  assert.equal(draft.ok, false);
  if (!draft.ok) assert.equal(draft.code, "limit");
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "");

  const creationDraft = await store.updateDraft("news", "creation", "c".repeat(MAX_CREATION_LENGTH + 1));
  assert.equal(creationDraft.ok, false);
  if (!creationDraft.ok) assert.equal(creationDraft.code, "limit");
  assert.equal(store.getSnapshot().workspace.sections.news.creationDraft, "");

  await store.updateDraft("news", "editorial", "x".repeat(MAX_DIRECTION_LENGTH + 1));
  const direction = await store.saveDirection("news", "news-a");
  assert.equal(direction.ok, false);
  if (!direction.ok) assert.equal(direction.code, "invalid");
  assert.equal(store.getSnapshot().workspace.sections.news.directions.length, 0);
});

test("each section has a bounded instruction history", async () => {
  const storage = new MemoryStorage();
  const store = makeStore(storage, { prefix: "bounded" });
  await store.reload();
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await store.updateDraft("news", "editorial", `Instruction ${index}`)).ok, true);
    assert.equal((await store.saveDirection("news", "news-a")).ok, true);
  }
  await store.updateDraft("news", "editorial", "One instruction too many");
  const result = await store.saveDirection("news", "news-a");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "limit");
  assert.equal(store.getSnapshot().workspace.sections.news.directions.length, 50);
  assert.equal(store.getSnapshot().workspace.sections.news.editorialDraft, "One instruction too many");
});

test("oversized or structurally invalid persisted schemas are recoverable corruption", async () => {
  const oversized = new MemoryStorage();
  oversized.values.set(publicationStorageKey(), "x".repeat(750_001));
  const oversizedStore = makeStore(oversized);
  await oversizedStore.reload();
  assert.match(oversizedStore.getSnapshot().storageError ?? "", /could not be read/);

  const invalid = new MemoryStorage();
  const key = publicationStorageKey();
  const workspace = createEmptyPublicationWorkspace(key) as unknown as Record<string, unknown>;
  (workspace.sections as Record<string, unknown>).news = {
    ...(workspace.sections as Record<string, Record<string, unknown>>).news,
    directions: [{ id: "wrong", section: "books", scope: "persistent", editionId: null, text: "Cross owned", revision: 0 }],
  };
  invalid.values.set(key, JSON.stringify(workspace));
  const invalidStore = makeStore(invalid);
  await invalidStore.reload();
  assert.match(invalidStore.getSnapshot().storageError ?? "", /could not be read/);
  assert.equal(invalid.values.get(key), JSON.stringify(workspace));
});
