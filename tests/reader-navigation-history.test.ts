import assert from "node:assert/strict";
import test from "node:test";
import { readerBackSteps, readerHistoryState } from "../lib/reader-navigation-history";

const home = { section: "news", view: "home", articleId: null, loopId: "for-you" };
const library = { ...home, view: "library" };
const article = { ...home, view: "article", articleId: "one" };
test("Library article and Next retain Library and its original parent across reload metadata", () => {
  const libraryState = readerHistoryState(home, library, { framework: "retained" });
  const articleState = readerHistoryState(library, article, libraryState);
  assert.deepEqual(articleState.__edisonArticleReturnRoute, library);
  assert.deepEqual(articleState.__edisonArticleReturnParent, home);
  const nextState = readerHistoryState(article, { ...article, articleId: "two" }, articleState);
  assert.deepEqual(nextState.__edisonArticleReturnRoute, library);
  const returned = readerHistoryState(article, library, nextState, home);
  assert.deepEqual(returned.__edisonReturnRoute, home);
  assert.equal(returned.framework, "retained");
});
test("opening from a feed clears stale Library origins", () => {
  const state = readerHistoryState(home, article, { __edisonArticleReturnRoute: library });
  assert.equal(state.__edisonArticleReturnRoute, null);
  assert.equal(state.__edisonFromPublication, true);
});
test("a direct Library visit without a parent cannot create an article return cycle", () => {
  const opened = readerHistoryState(library, article, {});
  const returned = readerHistoryState(article, library, opened, null);
  assert.equal(returned.__edisonReturnRoute, null);
});

test("article detours resume the real entry without converting its feed origin to Library", () => {
  const articleState = readerHistoryState(home, article, {});
  const libraryState = readerHistoryState(article, library, articleState);
  assert.equal(readerBackSteps(library, libraryState), 1);
  // Browser history resumes articleState, not a new Library-to-article entry.
  assert.equal(readerBackSteps(article, articleState), 1);
  assert.equal(articleState.__edisonArticleReturnRoute, null);
  const profile = { ...home, view: "profile" };
  const profileState = readerHistoryState(article, profile, articleState);
  const nestedLibraryState = readerHistoryState(profile, library, profileState);
  assert.equal(readerBackSteps(library, nestedLibraryState), 1);
  assert.equal(readerBackSteps(profile, profileState), 1);
  assert.equal(readerBackSteps(article, articleState), 1);
});

test("Next preserves the actual feed or Library history destination across several articles", () => {
  const first = readerHistoryState(library, article, {});
  const second = readerHistoryState(article, { ...article, articleId: "two" }, first);
  assert.equal(readerBackSteps(article, second), 2);
  assert.equal(readerBackSteps(article, {}), null);
  assert.equal(readerBackSteps(article, { __edisonRoute: true, __edisonArticleReturnSteps: 999 }), null);
});
