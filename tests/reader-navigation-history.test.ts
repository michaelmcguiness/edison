import assert from "node:assert/strict";
import test from "node:test";
import { readerHistoryState } from "../lib/reader-navigation-history";

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
