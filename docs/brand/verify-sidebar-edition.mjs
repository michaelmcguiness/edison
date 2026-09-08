/**
 * Source-level interaction checks for the Edison sidebar design reference.
 * This DOM stub does not validate browser layout, native focus, CSS, or routing.
 * Run: deno run --allow-read verify-sidebar-edition.mjs
 * Optional first argument: another sidebar-reference HTML path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";

const sourcePath = process.argv[2] || fileURLToPath(new URL("./edison-sidebar-edition.fragment.html", import.meta.url));
const html = readFileSync(sourcePath, "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(value => value.trim());
assert.equal(scripts.length, 1, "Expected one inline behavior script");
const [script] = scripts;
assert.ok(Buffer.byteLength(html) < 1_000_000, "Reference should stay below 1 MB");
new Function(script);
const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "");
const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate element IDs");
for (const [, id] of script.matchAll(/el\("([^"]+)"\)/g)) assert.ok(ids.includes(id), `Missing #${id}`);

const camel = value => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
let active = null;
let root;
const elements = [];
const nodes = new Map();
const targets = new Map();

class Element {
  constructor(id = "", dataset = {}, tagName = "BUTTON") {
    Object.assign(this, { id, dataset, tagName, hidden: false, disabled: false, open: false, value: "", textContent: "", innerHTML: "", attributes: {}, style: {}, scrollHeight: 46, scrollTop: 0, handlers: new Map() });
  }
  addEventListener(type, fn) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(fn);
    this.handlers.set(type, handlers);
  }
  fire(type, extra = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const fn of this.handlers.get(type) || []) fn(event);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[camel(name.slice(5))] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith("data-")) delete this.dataset[camel(name.slice(5))];
  }
  toggleAttribute(name, force = !this.hasAttribute(name)) { if (force) this.setAttribute(name, ""); else this.removeAttribute(name); return force; }
  focus() {
    // The DOM stub intentionally exposes the exact focused element to tests.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    active = this;
    this.fire("focus");
  }
  showModal() { this.open = true; }
  close() { const wasOpen = this.open; this.open = false; if (wasOpen) this.fire("close"); }
  requestSubmit() { this.fire("submit"); }
  scrollIntoView() {}
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return (this.attributes.class || "").split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([\w-]+)(?:=["']([^"']*)["'])?\]$/);
    if (attribute) {
      const [, name, value] = attribute;
      const actual = name.startsWith("data-") ? this.dataset[camel(name.slice(5))] : this.getAttribute(name);
      return actual != null && (value === undefined || actual === value);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector) { return this.matches(selector) ? this : null; }
  querySelector(selector) { return query(selector)[0] || null; }
  querySelectorAll(selector) { return query(selector); }
}

for (const [, tag, attrs] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
  const element = new Element("", {}, tag.toUpperCase());
  for (const [, name, doubleValue, singleValue, bareValue] of attrs.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    element.setAttribute(name, decode(doubleValue ?? singleValue ?? bareValue ?? ""));
  }
  element.id = element.getAttribute("id") || "";
  element.hidden = element.hasAttribute("hidden");
  element.disabled = element.hasAttribute("disabled");
  element.value = element.getAttribute("value") || "";
  elements.push(element);
  if (element.id) nodes.set(element.id, element);
  for (const [kind, value] of Object.entries(element.dataset)) {
    const key = `${kind}:${value}`;
    if (!targets.has(key)) targets.set(key, element);
  }
}
function get(id) { assert.ok(nodes.has(id), `Unknown element #${id}`); return nodes.get(id); }
root = get("edison-sidebar-edition");
function target(kind, value) {
  const key = `${kind}:${value}`;
  if (!targets.has(key)) targets.set(key, new Element("", { [kind]: value }));
  return targets.get(key);
}
function query(selector) {
  if (selector.startsWith("#")) return nodes.has(selector.slice(1)) ? [get(selector.slice(1))] : [];
  const selectors = selector.split(",").map(value => value.trim());
  const matches = elements.filter(element => selectors.some(item => element.matches(item)));
  const dynamic = selector.match(/^\[data-(read|save)="([^"]+)"\]$/);
  if (!matches.length && dynamic && get("pp-feed").innerHTML.includes(`data-${dynamic[1]}="${dynamic[2]}"`)) matches.push(target(camel(dynamic[1]), dynamic[2]));
  return matches;
}
const document = { getElementById: get, querySelector: selector => query(selector)[0] || null, querySelectorAll: query, get activeElement() { return active; } };
runInNewContext(script, { document, structuredClone });

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function clickElement(element) { element.fire("click"); if (element !== root) root.fire("click", { target: element }); return element; }
function click(id) { return clickElement(get(id)); }
function delegated(kind, value) { return clickElement(target(kind, value)); }
function section(value) { delegated("section", value); }
function scenario(value) { section("news"); get("pp-scenario").value = value; get("pp-scenario").fire("change"); }
function apply(scope = "future") { click("sb-example"); get("pp-scope").value = scope; get("pp-steer-form").fire("submit"); }
function order() { return [...new Set([...get("pp-feed").innerHTML.matchAll(/data-read="([^"]+)"/g)].map(match => match[1]))]; }
function type(id, value) { get(id).value = value; get(id).fire("input"); }
function currentSection() { return query("[data-section]").filter(element => element.getAttribute("aria-current") === "page").map(element => element.dataset.section); }
function brief() { return get("pp-brief-list").innerHTML; }
const initial = ["heat", "gps", "startup", "trees"];

test("Returning edition appears directly", () => {
  assert.equal(get("pp-personal").textContent, "Edited for Michael");
  assert.deepEqual(order(), initial);
  assert.equal(get("pp-receipt").hidden, true);
});
test("Guest has an honest starter label", () => { scenario("guest"); assert.equal(get("pp-personal").textContent, "A place to begin"); assert.match(brief(), /No editorial instructions/); });
test("Unsupported prompt discloses the local preview", () => {
  type("pp-prompt", "A wholly different request"); get("pp-steer-form").fire("submit");
  assert.match(get("pp-validation").textContent, /has not been sent or saved/);
  assert.deepEqual(order(), initial);
});
test("Example updates unread edition and future direction", () => {
  scenario("returning"); apply(); assert.deepEqual(order(), ["canals", "heat", "gps", "trees"]);
  assert.match(get("pp-receipt-text").textContent, /3 unread positions/); assert.match(brief(), /More economic history/);
});
test("Undo restores prior direction and edition", () => { click("pp-undo"); assert.deepEqual(order(), initial); assert.match(brief(), /Environment and technology/); assert.equal(active, get("pp-review")); });
test("Edition-only guidance leaves the persistent brief intact", () => { apply("today"); assert.match(brief(), /Environment and technology/); assert.match(brief(), /September 4 edition only/); assert.equal(get("pp-today").hidden, true); });
test("A successful persistent edit can become edition-only", () => { scenario("returning"); apply(); click("pp-today"); assert.match(brief(), /Environment and technology/); assert.match(brief(), /September 4 edition only/); });
test("Clear cannot resurrect instructions through scope conversion", () => { click("pp-clear-brief"); assert.equal(get("pp-today").hidden, true); click("pp-today"); assert.match(brief(), /No editorial instructions/); });
test("Individual removal preserves the other scope", () => { scenario("returning"); apply("today"); delegated("removeRule", "today"); assert.match(brief(), /Environment and technology/); assert.doesNotMatch(brief(), /More economic history/); });
test("An inferred-interest removal does not change instructions", () => { const original = brief(); click("pp-clear-learned"); assert.equal(brief(), original); assert.match(get("pp-learned").textContent, /No inferred/); });
test("Undo does not resurrect a later removed inference", () => { scenario("returning"); apply(); click("pp-clear-learned"); click("pp-undo"); assert.match(get("pp-learned").textContent, /No inferred/); });
test("Saving state leaves the old edition usable", () => { scenario("applying"); assert.deepEqual(order(), initial); assert.equal(get("pp-apply").disabled, true); assert.match(get("pp-receipt-text").textContent, /Saving/); assert.match(brief(), /Environment and technology/); });
test("Queued writing is distinct from ready content", () => { scenario("queued"); assert.deepEqual(order(), initial); assert.match(brief(), /More economic history/); assert.match(get("pp-receipt-text").textContent, /queued/); });
test("Failed save changes neither brief nor edition", () => { scenario("failed"); assert.deepEqual(order(), initial); assert.match(brief(), /Environment and technology/); assert.equal(get("pp-undo").hidden, true); click("pp-retry"); assert.equal(order()[0], "canals"); });
test("Writing failure retains saved direction, and retry preserves Undo", () => { scenario("generation-failed"); assert.deepEqual(order(), initial); assert.match(brief(), /More economic history/); assert.equal(get("pp-retry").textContent, "Retry writing"); click("pp-retry"); assert.equal(order()[0], "canals"); click("pp-undo"); assert.match(brief(), /Environment and technology/); });
test("Every opened version stays in place during Apply", () => { scenario("returning"); for (const key of initial) { delegated("read", key); click("pp-back"); } apply(); assert.deepEqual(order(), initial); assert.match(get("pp-receipt-text").textContent, /No ready stories changed/); assert.match(get("pp-feed").innerHTML, /Opened/); });
test("Saving changes only its control, preserving focus", () => {
  scenario("returning"); const oldFeed = get("pp-feed").innerHTML;
  const button = target("save", "startup"); button.focus(); delegated("save", "startup");
  assert.equal(active, button); assert.equal(button.getAttribute("aria-pressed"), "true"); assert.equal(get("pp-feed").innerHTML, oldFeed);
  apply(); assert.equal(order()[2], "startup");
});
test("Reading navigation places focus on useful controls", () => { scenario("returning"); delegated("read", "gps"); assert.equal(active, get("pp-back")); click("pp-back"); assert.equal(active, target("read", "gps")); });
test("A newly opened generated sample survives Undo", () => { scenario("ready"); delegated("read", "canals"); click("pp-back"); click("pp-undo"); assert.ok(order().includes("canals")); assert.ok(order().includes("startup")); });
test("One-off detection prefills without changing direction", () => {
  scenario("returning"); const original = brief(); type("pp-prompt", "Write me an article about public libraries"); get("pp-steer-form").fire("submit");
  assert.equal(get("pp-create-dialog").open, true); assert.match(get("pp-create-prompt").value, /public libraries/); assert.equal(brief(), original);
});
test("One-off drafts survive dismissal and reopening", () => { type("pp-create-prompt", "An unfinished thought"); get("pp-create-dialog").close(); click("pp-create"); assert.equal(get("pp-create-prompt").value, "An unfinished thought"); get("pp-create-form").fire("submit"); assert.match(get("pp-create-status").textContent, /nothing has been submitted/); get("pp-create-dialog").close(); });
test("IME composition cannot prematurely apply a note", () => { scenario("returning"); click("sb-example"); get("pp-prompt").fire("compositionstart"); get("pp-steer-form").fire("submit"); assert.deepEqual(order(), initial); get("pp-prompt").fire("compositionend"); get("pp-prompt").fire("keydown", { key: "Enter", shiftKey: false, isComposing: false }); assert.equal(order()[0], "canals"); });

test("Navigation contains exactly the three publication destinations", () => {
  assert.deepEqual(query("[data-section]").map(element => element.dataset.section), ["news", "books", "podcasts"]);
  assert.match(markup, /<nav\b[^>]*aria-label="Publication formats"/);
  assert.deepEqual(currentSection(), ["news"]);
});
test("Each destination updates selection, content, and contextual create label", () => {
  for (const [name, noun] of [["books", "book"], ["podcasts", "podcast"], ["news", "article"]]) {
    section(name); assert.deepEqual(currentSection(), [name]);
    assert.equal(get("sb-desk").textContent.toLowerCase(), name);
    assert.equal(get("pp-create").getAttribute("aria-label"), `Create one ${noun}`);
    assert.equal(get("pp-feed").hidden, name !== "news");
    assert.equal(get("sb-books").hidden, name !== "books");
    assert.equal(get("sb-podcasts").hidden, name !== "podcasts");
    assert.match(get("sb-steering").getAttribute("aria-label"), new RegExp(name, "i"));
  }
});
test("Creation dialog stays within the selected format", () => {
  for (const [name, noun] of [["news", "article"], ["books", "book"], ["podcasts", "podcast"]]) {
    section(name); const original = brief(); click("pp-create");
    assert.equal(get("pp-create-dialog").open, true);
    assert.match(get("sb-create-description").textContent, new RegExp(noun, "i"));
    assert.match(get("sb-create-submit").textContent, new RegExp(noun, "i"));
    assert.match(get("sb-create-scope").textContent, new RegExp(name, "i"));
    assert.equal(brief(), original); get("pp-create-dialog").close();
  }
});
test("Editorial drafts and scope survive section changes without leaking", () => {
  for (const [index, name] of ["news", "books", "podcasts"].entries()) {
    section(name); type("pp-prompt", `Unsubmitted ${name} direction`);
    get("pp-scope").value = index === 1 ? "today" : "future"; get("pp-scope").fire("change");
  }
  for (const [index, name] of ["news", "books", "podcasts"].entries()) {
    section(name); assert.equal(get("pp-prompt").value, `Unsubmitted ${name} direction`);
    assert.equal(get("pp-scope").value, index === 1 ? "today" : "future");
  }
});
test("One-off creation drafts are separately preserved in every format", () => {
  for (const name of ["news", "books", "podcasts"]) {
    section(name); click("pp-create"); type("pp-create-prompt", `Unsubmitted ${name} creation`); get("pp-create-dialog").close();
  }
  for (const name of ["news", "books", "podcasts"]) {
    section(name); click("pp-create"); assert.equal(get("pp-create-prompt").value, `Unsubmitted ${name} creation`); get("pp-create-dialog").close();
  }
});
const examples = {};
test("The visible example fills a distinct note for the current format", () => {
  for (const name of ["news", "books", "podcasts"]) {
    section(name); const original = brief(); click("sb-example"); examples[name] = get("pp-prompt").value;
    assert.ok(examples[name].trim()); assert.equal(brief(), original); assert.equal(get("pp-options").hidden, false);
  }
  assert.equal(new Set(Object.values(examples)).size, 3);
  assert.match(examples.news, /economic history/i);
});
test("Books guidance is accepted locally and does not change News or Podcasts", () => {
  section("news"); const newsBrief = brief(); const newsOrder = order();
  section("podcasts"); const podcastsBrief = brief();
  section("books"); apply(); assert.ok(brief().includes(examples.books)); assert.equal(get("pp-validation").hidden, true);
  assert.equal(get("pp-receipt").hidden, false); assert.match(get("pp-receipt-text").textContent, /book/i);
  section("news"); assert.equal(brief(), newsBrief); assert.deepEqual(order(), newsOrder);
  section("podcasts"); assert.equal(brief(), podcastsBrief);
});
test("Podcasts guidance and Undo preserve Books guidance", () => {
  section("books"); const booksBrief = brief();
  section("podcasts"); const priorPodcastBrief = brief(); apply();
  assert.ok(brief().includes(examples.podcasts)); assert.match(get("pp-receipt-text").textContent, /podcast/i);
  section("books"); assert.equal(brief(), booksBrief);
  section("podcasts"); click("pp-undo"); assert.equal(brief(), priorPodcastBrief);
  section("books"); assert.equal(brief(), booksBrief);
});
test("Clearing Books instructions leaves the other sections unchanged", () => {
  section("news"); const newsBrief = brief(); section("podcasts"); const podcastsBrief = brief();
  section("books"); click("pp-clear-brief"); assert.match(brief(), /No editorial instructions/);
  section("news"); assert.equal(brief(), newsBrief); section("podcasts"); assert.equal(brief(), podcastsBrief);
});
test("News Undo survives a detour into another format", () => {
  scenario("returning"); const newsBrief = brief(); apply();
  section("books"); const booksBrief = brief(); section("news"); click("pp-undo");
  assert.equal(brief(), newsBrief); assert.deepEqual(order(), initial);
  section("books"); assert.equal(brief(), booksBrief);
});
test("A book cover opens the honest book preview and close dismisses it", () => {
  section("books"); const book = query("[data-book]")[0]; assert.ok(book);
  delegated("book", book.dataset.book); assert.equal(get("sb-book-dialog").open, true);
  assert.equal(get("sb-book-title").textContent, book.dataset.book);
  assert.match(markup, /full text is not included in this preview/i);
  delegated("close", "sb-book-dialog"); assert.equal(get("sb-book-dialog").open, false);
});
test("Podcast preview announces a local audio limitation without pretending to play", () => {
  section("podcasts"); const audio = query("[data-audio]")[0]; assert.ok(audio);
  delegated("audio", audio.dataset.audio); assert.equal(get("sb-audio-note").hidden, false);
  assert.ok(get("sb-audio-note").textContent.includes(audio.dataset.audio));
  assert.match(get("sb-audio-note").textContent, /preview|sample|not connected|no audio/i);
});
test("Changing formats from a News story reveals the selected section", () => {
  section("news"); delegated("read", "heat"); assert.equal(get("pp-reader").hidden, false);
  section("books"); assert.equal(get("pp-home-view").hidden, false); assert.equal(get("pp-reader").hidden, true); assert.equal(get("sb-books").hidden, false);
});

test("Chat composer enables Send only for nonempty text", () => {
  scenario("returning"); assert.equal(get("pp-apply").disabled, true);
  type("pp-prompt", "  "); assert.equal(get("pp-apply").disabled, true);
  type("pp-prompt", "More science"); assert.equal(get("pp-apply").disabled, false);
  type("pp-prompt", ""); assert.equal(get("pp-apply").disabled, true);
});
test("Composer context and example change with the active format", () => {
  for (const name of ["news", "books", "podcasts"]) {
    section(name);
    assert.match(get("pp-prompt").attributes["aria-label"], new RegExp(name, "i"));
    assert.match(get("pp-apply").attributes["aria-label"], new RegExp(name, "i"));
    assert.ok(get("pp-prompt").placeholder.trim());
  }
});
test("Composing text temporarily disables Send", () => {
  scenario("returning"); click("sb-example");
  get("pp-prompt").fire("compositionstart"); assert.equal(get("pp-apply").disabled, true);
  get("pp-prompt").fire("compositionend"); assert.equal(get("pp-apply").disabled, false);
});
test("Shift Enter does not submit and the composer expands for longer text", () => {
  scenario("returning"); click("sb-example");
  get("pp-prompt").fire("keydown", { key: "Enter", shiftKey: true, isComposing: false });
  assert.deepEqual(order(), initial);
  get("pp-prompt").scrollHeight = 144; get("pp-prompt").fire("input");
  assert.equal(get("pp-prompt").style.height, "144px");
});

console.log(`\n${checks} source-level interaction checks passed. Browser layout, native focus, viewport/keyboard, and production integration remain manual/integration QA.`);
