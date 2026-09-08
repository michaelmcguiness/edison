import assert from "node:assert/strict";
import test from "node:test";
import {
  editorialSections,
  isCompositionEnter,
} from "../components/edison/editorial-composer";

test("editorial composer exposes the approved section-specific prompts", () => {
  assert.equal(editorialSections.news.placeholder, "More economic history, less startup news…");
  assert.equal(editorialSections.books.placeholder, "Short books on history and architecture…");
  assert.equal(editorialSections.podcasts.placeholder, "More science. Episodes under 30 minutes…");
  assert.deepEqual(Object.keys(editorialSections), ["news", "books", "podcasts"]);
});

test("IME composition Enter never becomes a submission Enter", () => {
  assert.equal(isCompositionEnter(true, false, 13, null, 100), true);
  assert.equal(isCompositionEnter(false, true, 13, null, 100), true);
  assert.equal(isCompositionEnter(false, false, 229, null, 100), true);
});

test("Safari-style confirmation Enter is suppressed just after compositionend", () => {
  assert.equal(isCompositionEnter(false, false, 13, 1_000, 1_149), true);
  assert.equal(isCompositionEnter(false, false, 13, 1_000, 1_150), false);
});

test("ordinary Enter and an invalid future timestamp are not mistaken for IME", () => {
  assert.equal(isCompositionEnter(false, false, 13, null, 100), false);
  assert.equal(isCompositionEnter(false, false, 13, 200, 100), false);
});
