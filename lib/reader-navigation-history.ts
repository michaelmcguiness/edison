type Route = { section: string; view: string; articleId: string | null; loopId?: string };

export function readerHistoryState<T extends Record<string, unknown>>(current: Route, next: Route, previous: T, returnOverride?: Route | null, replacing = false) {
  const articleFromLibrary = next.view === "article" && current.view === "library";
  const continuingArticle = next.view === "article" && current.view === "article";
  const priorSteps = readerBackSteps(current, previous);
  return {
    ...previous,
    __edisonRoute: true,
    __edisonFromPublication: current.view === "home",
    __edisonScrollY: 0,
    __edisonReturnRoute: next.view === "library" || next.view === "profile" ? returnOverride !== undefined ? returnOverride : current : null,
    __edisonArticleReturnRoute: articleFromLibrary ? current : continuingArticle ? previous.__edisonArticleReturnRoute ?? null : null,
    __edisonArticleReturnParent: articleFromLibrary ? previous.__edisonReturnRoute ?? null : continuingArticle ? previous.__edisonArticleReturnParent ?? null : null,
    __edisonArticleReturnSteps: !replacing && next.view === "article"
      ? current.view === "home" || current.view === "library" ? 1 : continuingArticle && priorSteps !== null ? priorSteps + 1 : null
      : null,
  };
}

/** Resume the actual entry, preserving its original return metadata on detours. */
export function readerBackSteps(current: Route, state: Record<string, unknown>): number | null {
  if (!state.__edisonRoute) return null;
  if ((current.view === "library" || current.view === "profile") && state.__edisonReturnRoute) return 1;
  const steps = state.__edisonArticleReturnSteps;
  return current.view === "article" && typeof steps === "number" && Number.isInteger(steps) && steps >= 1 && steps <= 60 ? steps : null;
}
