import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { restoreDemandDialogFocus } from "../components/edison/demand-reader";

type Element = { type: string; props: Record<string, unknown> };
type AutoFocusEvent = { preventDefault: () => void };
type DialogProps = { onClose: () => void; onRestoreFocus: () => void };

// Execute the real component callbacks with an injected modal lifecycle. This
// proves callback ordering/wiring, not browser focus-trap behavior itself.
function renderDialog(kind: "curate" | "allowance", props: DialogProps): Element {
  const path = kind === "curate" ? "components/edison/demand-v10/loop-editor.tsx" : "components/edison/demand-v11/allowance-wall.tsx";
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const exports: Record<string, (input: Record<string, unknown>) => Element> = {};
  const jsx = (type: string, attributes: Record<string, unknown>) => ({ type, props: attributes });
  new Script(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { filename: path }).runInNewContext({
    exports, localStorage: { getItem: () => null },
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react") return {
        useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
        useRef: (current: unknown) => ({ current }), useId: () => "dialog-test", useEffect: () => {},
      };
      if (name === "lucide-react") return { X: "X" };
      if (name === "@/components/ui/dialog") return { Dialog: "Dialog", DialogContent: "DialogContent", DialogTitle: "DialogTitle", DialogDescription: "DialogDescription" };
      if (name === "@/components/edison/editorial-composer") return { useEditorialDialogViewport: () => ({ current: null }) };
      if (name === "./reader-state") return {
        readScopedDraft: (_key: string, fallback: unknown) => fallback,
        loopDraftChanged: () => false,
      };
      if (name === "./state") return { allowanceResetLabel: () => "Monday" };
      if (name === "./reset-state") return { validResetAttempt: () => false };
      throw new Error(`Unexpected dialog test dependency: ${name}`);
    },
  });
  return kind === "curate"
    ? exports.LoopEditor({ ...props, workspaceId: "test-reader", loop: { id: "test-loop", title: "Physics", revision: 1, principles: [] }, instructions: "Explain mechanisms.", onSave: async () => {}, onDelete: async () => {} })
    : exports.AllowanceWall({ ...props, workspaceId: "test-reader", allowance: { remaining: 0 }, onReset: async () => {} });
}

function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== "object" || !("type" in root) || !("props" in root)) return [];
  const element = root as Element;
  return [element, ...elements(element.props.children)];
}

for (const kind of ["curate", "allowance"] as const) {
  test(`${kind}: Escape requests close without focusing the inert opener, then teardown restores it`, () => {
    let isolated = true;
    let active = "dialog";
    let closes = 0;
    let restores = 0;
    const opener = {
      isConnected: true, hasAttribute: () => false, getAttribute: () => null,
      focus(options: FocusOptions) {
        assert.deepEqual(options, { preventScroll: true });
        assert.equal(isolated, false, "restoration must wait for modal teardown");
        active = "opener";
      },
    } as unknown as HTMLElement;
    const tree = renderDialog(kind, {
      onClose: () => { closes++; },
      onRestoreFocus: () => { restores++; restoreDemandDialogFocus(opener, null); },
    });
    assert.equal(tree.type, "Dialog");
    assert.equal(tree.props.open, true, "the existing modal remains open and trapped until its owner closes it");
    const onOpenChange = tree.props.onOpenChange as (open: boolean) => void;
    onOpenChange(true);
    assert.equal(closes, 0);
    onOpenChange(false); // Radix Escape/dismiss path.
    assert.equal(closes, 1);
    assert.equal(restores, 0);
    assert.equal(active, "dialog");

    // Simulate Radix's delayed unmount callback after its isolation cleanup.
    isolated = false;
    active = "body";
    let prevented = false;
    const content = elements(tree).find(({ type }) => type === "DialogContent")!;
    assert.equal(content.props.trapFocus, undefined, "do not override the shared modal trap");
    assert.equal(content.props.modal, undefined, "do not weaken the shared modal");
    (content.props.onCloseAutoFocus as (event: AutoFocusEvent) => void)({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, "the absent DialogTrigger must not steal the chosen restoration target");
    assert.equal(restores, 1);
    assert.equal(active, "opener");
  });

  test(`${kind}: explicit close controls use the same teardown callback and preserve fallback restoration`, () => {
    let closes = 0;
    let restores = 0;
    let focused = false;
    const fallback = {
      isConnected: true, hasAttribute: () => false, getAttribute: () => null,
      focus: () => { focused = true; },
    } as unknown as HTMLElement;
    const detached = { ...fallback, isConnected: false } as HTMLElement;
    const tree = renderDialog(kind, {
      onClose: () => { closes++; },
      onRestoreFocus: () => { restores++; restoreDemandDialogFocus(detached, fallback); },
    });
    const controls = elements(tree).filter(({ type, props }) => type === "button" &&
      (props["aria-label"] === (kind === "curate" ? "Close loop editor" : "Close article allowance") || props.children === (kind === "curate" ? "Cancel" : "Keep reading")));
    assert.equal(controls.length, 2);
    for (const control of controls) (control.props.onClick as () => void)();
    assert.equal(closes, 2);
    assert.equal(restores, 0);
    assert.equal(focused, false);
    const content = elements(tree).find(({ type }) => type === "DialogContent")!;
    (content.props.onCloseAutoFocus as (event: AutoFocusEvent) => void)({ preventDefault() {} });
    assert.equal(restores, 1);
    assert.equal(focused, true);
  });
}

test("reader restores Curate and Account allowance only through the modal lifecycle, including browser Back", () => {
  const source = readFileSync(new URL("../components/edison/demand-reader.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("demand-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dialogs = new Map<string, Map<string, string>>();
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && ["LoopEditor", "AllowanceWall"].includes(node.tagName.getText(file))) {
      const props = new Map<string, string>();
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) props.set(attribute.name.getText(file), attribute.initializer?.getText(file) ?? "");
      dialogs.set(node.tagName.getText(file), props);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(dialogs.size, 2);
  assert.match(dialogs.get("LoopEditor")!.get("onClose")!, /setCurateOpen\(false\)/);
  assert.doesNotMatch(dialogs.get("LoopEditor")!.get("onClose")!, /restoreDemandDialogFocus|focus\(/);
  assert.match(dialogs.get("LoopEditor")!.get("onRestoreFocus")!, /restoreDemandDialogFocus\(curateOpenerRef.current, readingSurfaceRef.current\)/);
  assert.equal(dialogs.get("AllowanceWall")!.get("onClose"), "{closeActionOverlay}");
  assert.match(dialogs.get("AllowanceWall")!.get("onRestoreFocus")!, /restoreDemandDialogFocus\(allowanceOpenerRef.current, readingSurfaceRef.current\)/);
  const popstate = source.slice(source.indexOf("const onPopState = () =>"), source.indexOf("const intent = ++navigationIntentRef.current", source.indexOf("const onPopState = () =>")));
  assert.match(popstate, /consumeDemandActionOverlayPop\(actionOverlayRef.current, window.history, window.location.href, setAllowanceOpen\)/);
  assert.doesNotMatch(popstate, /restoreDemandDialogFocus|requestAnimationFrame/);
});
