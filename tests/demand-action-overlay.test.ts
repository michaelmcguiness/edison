import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  closeDemandActionOverlay, consumeDemandActionOverlayPop,
  initialDemandActionOverlay, openDemandActionOverlay,
} from "../components/edison/demand-v11/action-overlay";

function fixture() {
  const href = "https://edison.example/demand/articles/retained-article?fixture=one";
  const original = { __NA: true, demandNavigation: { view: "article", origin: "saved-reading" } };
  const entries: { state: Record<string, unknown>; href: string }[] = [{ state: original, href }];
  let index = 0;
  let visible = false;
  let backCalls = 0;
  let pendingBacks = 0;
  let readerNavigations = 0;
  const changes: boolean[] = [];
  const state = initialDemandActionOverlay();
  const history = {
    get state() { return entries[index].state; },
    pushState(data: Record<string, unknown>, _unused: string, url?: string | URL | null) {
      assert.equal(url, href, "overlay entries preserve the exact current reader URL");
      entries.splice(index + 1);
      entries.push({ state: data, href: String(url) });
      index++;
    },
    back() { backCalls++; pendingBacks++; },
  };
  const setOpen = (open: boolean) => { visible = open; changes.push(open); };
  const pop = () => {
    assert.ok(index > 0);
    index--;
    const consumed = consumeDemandActionOverlayPop(state, history, entries[index].href, setOpen);
    if (!consumed) readerNavigations++;
    return consumed;
  };
  return {
    state, history, changes, original, entries,
    open: () => openDemandActionOverlay(state, "allowance", history, href, setOpen),
    close: () => closeDemandActionOverlay(state, history, setOpen),
    browserBack: pop,
    flushCloseBack() { assert.equal(pendingBacks, 1); pendingBacks--; return pop(); },
    unrelatedPop: (destination = href) => consumeDemandActionOverlayPop(state, history, destination, setOpen),
    get visible() { return visible; }, get backCalls() { return backCalls; },
    get pendingBacks() { return pendingBacks; }, get readerNavigations() { return readerNavigations; },
    get index() { return index; },
  };
}

for (const reason of ["successful reset", "Escape", "Keep reading", "close button"]) {
  test(`${reason} dismisses immediately and consumes only its own delayed history reconciliation`, () => {
    const f = fixture();
    f.open();
    assert.equal(f.visible, true);
    assert.deepEqual(f.history.state.demandNavigation, f.original.demandNavigation);
    f.close();
    assert.equal(f.visible, false, "the modal must not depend on popstate arriving");
    assert.equal(f.index, 1, "the synthetic browser has deliberately not traversed yet");
    assert.equal(f.backCalls, 1);
    assert.equal(f.flushCloseBack(), true);
    assert.equal(f.readerNavigations, 0);
    assert.equal(f.visible, false);
    assert.equal(f.index, 0);
    assert.deepEqual(f.history.state, f.original);
    assert.equal(f.unrelatedPop(), false, "a later ordinary reader navigation is not swallowed");
  });
}

test("double close and an ignored traversal cannot keep the wall visible or schedule multiple backs", () => {
  const f = fixture();
  f.open();
  f.open();
  assert.equal(f.entries.length, 2);
  f.close(); f.close(); f.close();
  assert.equal(f.visible, false);
  assert.equal(f.backCalls, 1);
  assert.equal(f.pendingBacks, 1);
  assert.equal(f.readerNavigations, 0);
  // No synthetic popstate: immediate close is still complete.
});

test("browser Back on an open wall dismisses it without another traversal", () => {
  const f = fixture();
  f.open();
  assert.equal(f.browserBack(), true);
  assert.equal(f.visible, false);
  assert.equal(f.backCalls, 0);
  assert.equal(f.readerNavigations, 0);
});

test("a newer reopen survives an earlier close's delayed popstate and owns a fresh same-URL entry", () => {
  const f = fixture();
  f.open();
  const firstMarker = f.history.state.demandActionOverlay;
  f.close();
  f.open();
  assert.equal(f.visible, true);
  assert.equal(f.history.state.demandActionOverlay, firstMarker, "do not push in front of the outstanding back");
  assert.equal(f.entries.length, 2);
  assert.equal(f.flushCloseBack(), true);
  assert.equal(f.visible, true);
  assert.equal(f.index, 1);
  assert.notEqual(f.history.state.demandActionOverlay, firstMarker);
  assert.equal(f.readerNavigations, 0);
  assert.deepEqual(f.changes, [true, false, true], "the stale close cannot dismiss or refocus the newer modal");
  f.close();
  assert.equal(f.backCalls, 2);
  assert.equal(f.flushCloseBack(), true);
  assert.equal(f.visible, false);
  assert.equal(f.index, 0);
});

test("reopen followed by another close before reconciliation does not leave a phantom overlay entry", () => {
  const f = fixture();
  f.open(); f.close(); f.open(); f.close();
  assert.equal(f.visible, false);
  assert.equal(f.backCalls, 1);
  f.flushCloseBack();
  assert.equal(f.visible, false);
  assert.equal(f.index, 0);
  assert.deepEqual(f.history.state, f.original);
});

test("close cannot traverse an unowned or replaced history marker", () => {
  const f = fixture();
  f.open();
  f.history.state.demandActionOverlay = "another-overlay";
  f.close();
  assert.equal(f.visible, false);
  assert.equal(f.backCalls, 0);
  assert.equal(f.state.pendingBack, false);
  assert.equal(f.unrelatedPop(), false);
});

test("an ignored close cannot consume an unrelated later reader URL or same-URL navigation state", () => {
  for (const changed of ["url", "navigation"] as const) {
    const f = fixture();
    f.open(); f.close(); f.open();
    if (changed === "navigation") f.history.state.demandNavigation = { view: "library", origin: "different-history-page" };
    assert.equal(f.unrelatedPop(changed === "url" ? "https://edison.example/demand/articles/different-article" : undefined), false);
    assert.equal(f.visible, false, "normal reader navigation retires the unrelated wall");
    assert.equal(f.state.pendingBack, false);
    assert.equal(f.backCalls, 1, "never compensate with a guessed extra traversal");
    assert.equal(f.entries.length, 2, "do not plant a reopened wall on an unrelated reader destination");
  }
});

test("reset success and all dismissal controls converge on immediate close; failed resets keep their recovery UI", () => {
  const wall = readFileSync(new URL("../components/edison/demand-v11/allowance-wall.tsx", import.meta.url), "utf8");
  const success = wall.slice(wall.indexOf("await onReset("), wall.indexOf("} catch (failure)"));
  assert.match(success, /setPassword\(""\); onClose\(\)/);
  const failure = wall.slice(wall.indexOf("} catch (failure)"), wall.indexOf("finally { lock.current"));
  assert.doesNotMatch(failure, /onClose\(/);
  assert.match(wall, /onOpenChange=\{\(open\) => \{ if \(!open\) onClose\(\); \}\}/);
  const reader = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  const close = reader.slice(reader.indexOf("function closeActionOverlay()"), reader.indexOf("function gateArticleAction()"));
  assert.match(close, /closeDemandActionOverlay\(actionOverlayRef.current, window.history, setAllowanceOpen\)/);
  assert.doesNotMatch(close, /history\.back\(|restoreDemandDialogFocus|requestAnimationFrame/);
});
