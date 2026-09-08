export type DemandActionOverlayState = {
  kind: "allowance" | null;
  entryId: string | null;
  pendingBack: boolean;
  returnLocation: { href: string; navigation: string } | null;
};

type OverlayHistory = Pick<History, "state" | "pushState" | "back">;
type SetOpen = (open: boolean) => void;

export function initialDemandActionOverlay(): DemandActionOverlayState {
  return { kind: null, entryId: null, pendingBack: false, returnLocation: null };
}

function navigationIdentity(history: OverlayHistory) {
  return JSON.stringify(history.state?.demandNavigation ?? null);
}

function pushOverlayEntry(state: DemandActionOverlayState, history: OverlayHistory, href: string) {
  state.returnLocation = { href, navigation: navigationIdentity(history) };
  state.entryId = crypto.randomUUID();
  history.pushState({ ...history.state, demandActionOverlay: state.entryId }, "", href);
}

export function openDemandActionOverlay(state: DemandActionOverlayState, kind: "allowance", history: OverlayHistory, href: string, setOpen: SetOpen) {
  if (state.kind) return;
  state.kind = kind;
  // A preceding close owns the outstanding traversal. Reconcile that first,
  // rather than pushing another entry that it could accidentally traverse.
  if (!state.pendingBack) pushOverlayEntry(state, history, href);
  setOpen(true);
}

export function closeDemandActionOverlay(state: DemandActionOverlayState, history: OverlayHistory, setOpen: SetOpen) {
  state.kind = null;
  setOpen(false); // Dismissal never waits for an asynchronous/ignored traversal.
  if (state.pendingBack) return;
  const entryId = state.entryId;
  state.entryId = null;
  if (entryId && history.state?.demandActionOverlay === entryId) {
    state.pendingBack = true;
    history.back();
  } else state.returnLocation = null;
}

/** True means this traversal belongs to the overlay, not reader navigation. */
export function consumeDemandActionOverlayPop(state: DemandActionOverlayState, history: OverlayHistory, href: string, setOpen: SetOpen) {
  const ownReturn = state.returnLocation?.href === href && state.returnLocation.navigation === navigationIdentity(history);
  if (state.pendingBack) {
    state.pendingBack = false;
    state.entryId = null;
    state.returnLocation = null;
    if (!ownReturn) {
      state.kind = null;
      setOpen(false);
      return false; // An ignored back must not swallow later reader navigation.
    }
    // A newer open intent must survive the earlier close's delayed popstate.
    if (state.kind) pushOverlayEntry(state, history, href);
    return true;
  }
  if (!state.kind) return false;
  state.kind = null;
  state.entryId = null;
  state.returnLocation = null;
  setOpen(false);
  return ownReturn;
}
