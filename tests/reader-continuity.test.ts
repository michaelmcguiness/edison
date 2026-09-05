import assert from "node:assert/strict";
import test from "node:test";
import { boundedRecord, continuityStorageKey, createReadingJourney, nextReadableArticle, readReaderContinuity, validReaderLoopId } from "../lib/reader-continuity";

const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);

test("frozen reading order deduplicates and Next opens a real available destination", () => {
  const journey = createReadingJourney("for-you", [ids[0], ids[0], ids[1], ids[2]], ids[0], 240);
  assert.deepEqual(journey.articleIds, ids);
  const readable = [{ id: ids[2], title: "Third" }, { id: ids[0], title: "First" }];
  assert.equal(nextReadableArticle(ids[0], journey, readable)?.title, "Third");
  assert.equal(nextReadableArticle(ids[2], journey, readable), null);
  assert.equal(nextReadableArticle("unknown", journey, readable), null);
  assert.equal(nextReadableArticle(ids[0], null, readable), null);
});

test("loop routes never accept private text or unsafe destinations", () => {
  assert.equal(validReaderLoopId("for-you"), "for-you");
  assert.equal(validReaderLoopId(ids[0]), ids[0]);
  for (const value of ["my medical question", "//evil.test", "javascript:alert(1)", null, ""]) {
    assert.equal(validReaderLoopId(value), undefined);
  }
  assert.notEqual(continuityStorageKey("one"), continuityStorageKey("two"));
  assert.notEqual(continuityStorageKey(), continuityStorageKey("guest"));
});

test("corrupt continuity cannot replace safe navigation and storage stays bounded", () => {
  assert.deepEqual(readReaderContinuity("{invalid"), readReaderContinuity(null));
  assert.deepEqual(readReaderContinuity('{"version":2}'), readReaderContinuity(null));
  assert.deepEqual(boundedRecord({ a: 1, b: 2 }, "c", 3, 2), { b: 2, c: 3 });
  assert.deepEqual(boundedRecord({ a: 1, b: 2 }, "a", 4, 2), { b: 2, a: 4 });
});
