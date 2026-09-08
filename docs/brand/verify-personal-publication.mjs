/**
 * Source-level checks for the design reference, not browser or app tests.
 * Run: node docs/brand/verify-personal-publication.mjs
 * Or:  deno run --allow-read docs/brand/verify-personal-publication.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";

const sourcePath = process.argv[2] || fileURLToPath(new URL("./edison-personal-publication.fragment.html", import.meta.url));
const html = readFileSync(sourcePath, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Expected one inline behavior script");
assert.ok(Buffer.byteLength(html) < 1_000_000, "Fragment should stay below 1 MB");
new Function(script);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate element IDs");
for (const [, id] of script.matchAll(/el\("([^"]+)"\)/g)) assert.ok(ids.includes(id), `Missing #${id}`);

let active = null;
class Element {
  constructor(id = "", dataset = {}) {
    Object.assign(this, { id, dataset, hidden: false, disabled: false, open: false, value: "", textContent: "", innerHTML: "", attributes: {}, style: {}, scrollHeight: 46, handlers: new Map() });
  }
  addEventListener(type, fn) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(fn);
    this.handlers.set(type, handlers);
  }
  fire(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (const fn of this.handlers.get(type) || []) fn(event);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {
    // The DOM stub intentionally exposes the exact focused element to tests.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    active = this;
    this.fire("focus");
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  requestSubmit() { this.fire("submit"); }
  closest(selector) {
    const key = selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return key && Object.hasOwn(this.dataset, key) ? this : null;
  }
}
const nodes = new Map(ids.map(id => [id, new Element(id)]));
const get = id => {
  assert.ok(nodes.has(id), `Unknown element #${id}`);
  return nodes.get(id);
};
const root = get("edison-personal-publication");
root.querySelector = selector => {
  if (selector.startsWith("#")) return get(selector.slice(1));
  const key = selector.match(/^\[data-read="([^"]+)"\]$/)?.[1];
  if (key && get("pp-feed").innerHTML.includes(`data-read="${key}"`)) return target("read", key);
  return null;
};
const targets = new Map();
function target(kind, value) {
  const key = `${kind}:${value}`;
  if (!targets.has(key)) targets.set(key, new Element("", { [kind]: value }));
  return targets.get(key);
}
const document = { getElementById: get };
runInNewContext(script, { document, structuredClone });
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function click(id) { get(id).fire("click"); }
function delegated(kind, value) { const element = target(kind, value); root.fire("click", { target: element }); return element; }
function scenario(value) { get("pp-scenario").value = value; get("pp-scenario").fire("change"); }
function apply(scope = "future") { click("pp-try"); get("pp-scope").value = scope; get("pp-steer-form").fire("submit"); }
function order() { return [...new Set([...get("pp-feed").innerHTML.matchAll(/data-read="([^"]+)"/g)].map(match => match[1]))]; }
const initial = ["heat", "gps", "startup", "trees"];

test("Returning edition appears directly", () => {
  assert.equal(get("pp-personal").textContent, "Edited for Michael");
  assert.deepEqual(order(), initial);
  assert.equal(get("pp-receipt").hidden, true);
});
test("Guest has an honest starter label", () => { scenario("guest"); assert.equal(get("pp-personal").textContent, "A place to begin"); assert.match(get("pp-brief-list").innerHTML, /No editorial instructions/); });
test("Unsupported prompt discloses the local preview", () => {
  get("pp-prompt").value = "A wholly different request";
  get("pp-steer-form").fire("submit");
  assert.match(get("pp-validation").textContent, /has not been sent or saved/);
  assert.deepEqual(order(), initial);
});
test("Example updates unread edition and future direction", () => {
  scenario("returning"); apply();
  assert.deepEqual(order(), ["canals", "heat", "gps", "trees"]);
  assert.match(get("pp-receipt-text").textContent, /3 unread positions/);
  assert.match(get("pp-brief-list").innerHTML, /More economic history/);
});
test("Undo restores prior direction and edition", () => { click("pp-undo"); assert.deepEqual(order(), initial); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); assert.equal(active, get("pp-review")); });
test("Edition-only guidance leaves the persistent brief intact", () => { apply("today"); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); assert.match(get("pp-brief-list").innerHTML, /September 4 edition only/); assert.equal(get("pp-today").hidden, true); });
test("A successful persistent edit can become edition-only", () => { scenario("returning"); apply(); click("pp-today"); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); assert.match(get("pp-brief-list").innerHTML, /September 4 edition only/); });
test("Clear cannot resurrect instructions through scope conversion", () => {
  click("pp-clear-brief");
  assert.equal(get("pp-today").hidden, true);
  click("pp-today");
  assert.match(get("pp-brief-list").innerHTML, /No editorial instructions/);
});
test("Individual removal preserves the other scope", () => {
  scenario("returning"); apply("today"); delegated("removeRule", "today");
  assert.match(get("pp-brief-list").innerHTML, /Environment and technology/);
  assert.doesNotMatch(get("pp-brief-list").innerHTML, /More economic history/);
});
test("An inferred-interest removal does not change instructions", () => { const brief = get("pp-brief-list").innerHTML; click("pp-clear-learned"); assert.equal(get("pp-brief-list").innerHTML, brief); assert.match(get("pp-learned").textContent, /No inferred/); });
test("Undo does not resurrect a later removed inference", () => { scenario("returning"); apply(); click("pp-clear-learned"); click("pp-undo"); assert.match(get("pp-learned").textContent, /No inferred/); });
test("Saving state leaves the old edition usable", () => { scenario("applying"); assert.deepEqual(order(), initial); assert.equal(get("pp-apply").disabled, true); assert.match(get("pp-receipt-text").textContent, /Saving/); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); });
test("Queued writing is distinct from ready content", () => { scenario("queued"); assert.deepEqual(order(), initial); assert.match(get("pp-brief-list").innerHTML, /More economic history/); assert.match(get("pp-receipt-text").textContent, /queued/); });
test("Failed save changes neither brief nor edition", () => { scenario("failed"); assert.deepEqual(order(), initial); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); assert.equal(get("pp-undo").hidden, true); click("pp-retry"); assert.equal(order()[0], "canals"); });
test("Writing failure retains saved direction, and retry preserves Undo", () => { scenario("generation-failed"); assert.deepEqual(order(), initial); assert.match(get("pp-brief-list").innerHTML, /More economic history/); assert.equal(get("pp-retry").textContent, "Retry writing"); click("pp-retry"); assert.equal(order()[0], "canals"); click("pp-undo"); assert.match(get("pp-brief-list").innerHTML, /Environment and technology/); });
test("Every opened version stays in place during Apply", () => {
  scenario("returning");
  for (const key of initial) { delegated("read", key); click("pp-back"); }
  apply();
  assert.deepEqual(order(), initial);
  assert.match(get("pp-receipt-text").textContent, /No ready stories changed/);
  assert.match(get("pp-feed").innerHTML, /Opened/);
});
test("Saving changes only its control, preserving focus", () => {
  scenario("returning");
  const oldFeed = get("pp-feed").innerHTML;
  const button = target("save", "startup"); button.focus(); delegated("save", "startup");
  assert.equal(active, button);
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.equal(get("pp-feed").innerHTML, oldFeed);
  apply(); assert.equal(order()[2], "startup");
});
test("Reading navigation places focus on useful controls", () => { scenario("returning"); delegated("read", "gps"); assert.equal(active, get("pp-back")); click("pp-back"); assert.equal(active, target("read", "gps")); });
test("A newly opened generated sample survives Undo", () => { scenario("ready"); delegated("read", "canals"); click("pp-back"); click("pp-undo"); assert.ok(order().includes("canals")); assert.ok(order().includes("startup")); });
test("One-off detection prefills without changing direction", () => {
  scenario("returning"); const brief = get("pp-brief-list").innerHTML;
  get("pp-prompt").value = "Write me an article about public libraries"; get("pp-steer-form").fire("submit");
  assert.equal(get("pp-create-dialog").open, true);
  assert.match(get("pp-create-prompt").value, /public libraries/);
  assert.equal(get("pp-brief-list").innerHTML, brief);
});
test("One-off drafts survive dismissal and reopening", () => { get("pp-create-prompt").value = "An unfinished thought"; get("pp-create-dialog").close(); click("pp-create"); assert.equal(get("pp-create-prompt").value, "An unfinished thought"); get("pp-create-form").fire("submit"); assert.match(get("pp-create-status").textContent, /nothing has been submitted/); });
test("IME composition cannot prematurely apply a note", () => { scenario("returning"); click("pp-try"); get("pp-prompt").fire("compositionstart"); get("pp-steer-form").fire("submit"); assert.deepEqual(order(), initial); get("pp-prompt").fire("compositionend"); get("pp-prompt").fire("keydown", { key: "Enter", shiftKey: false, isComposing: false }); assert.equal(order()[0], "canals"); });

console.log(`\n${checks} source-level interaction checks passed. Browser layout, native focus, viewport/keyboard, and production integration remain manual/integration QA.`);
