type Route = { section: string; view: string; articleId: string | null; loopId?: string };

export function readerHistoryState<T extends Record<string, unknown>>(current: Route, next: Route, previous: T, returnOverride?: Route | null) {
  const articleFromLibrary = next.view === "article" && current.view === "library";
  const continuingArticle = next.view === "article" && current.view === "article";
  return {
    ...previous,
    __edisonRoute: true,
    __edisonFromPublication: current.view === "home",
    __edisonScrollY: 0,
    __edisonReturnRoute: next.view === "library" || next.view === "profile" ? returnOverride !== undefined ? returnOverride : current : null,
    __edisonArticleReturnRoute: articleFromLibrary ? current : continuingArticle ? previous.__edisonArticleReturnRoute ?? null : null,
    __edisonArticleReturnParent: articleFromLibrary ? previous.__edisonReturnRoute ?? null : continuingArticle ? previous.__edisonArticleReturnParent ?? null : null,
  };
}
