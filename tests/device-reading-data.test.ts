import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingArticleQuestions } from "../lib/device-reading-data";

test("clearing pending questions is account scoped and preserves unrelated drafts", () => {
  const values = new Map([
    ["edison:pending-question:v1:account:reader:article-a", "question one"],
    ["edison:pending-question:v1:account:reader:article-b", "question two"],
    ["edison:pending-question:v1:account:reader-two:article-a", "other reader"],
    ["edison:other-draft", "other format"],
  ]);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  clearPendingArticleQuestions(storage);
  assert.equal(values.size, 4);
  clearPendingArticleQuestions(storage, "reader");
  assert.deepEqual([...values.values()], ["other reader", "other format"]);
});

test("failed local deletion is surfaced rather than reported as cleared", () => {
  assert.throws(() => clearPendingArticleQuestions({ get length(): number { throw new Error("denied"); } } as unknown as Storage, "reader"), /denied/);
});
