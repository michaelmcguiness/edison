import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { WebAppMode } from "../lib/app-mode";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "app/page.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function PulseStub() { return null; }
function DemandStub() { return null; }
function BrandStub() { return null; }

type Claims = {
  sub?: string;
  email?: string;
  user_metadata?: { display_name?: string; full_name?: string };
};

// Execute the actual page branch logic without loading either client app or
// contacting Auth. Mode resolution itself is covered in app-mode.test.ts.
async function home(options: {
  mode: WebAppMode;
  flag?: string;
  claims?: Claims;
  environment?: Record<string, string>;
}) {
  let authCalls = 0;
  let clientCalls = 0;
  let stylesheetImports = 0;
  const exports: {
    default?: () => Promise<ReactElement<Record<string, unknown>>>;
    dynamic?: string;
  } = {};
  new Script(compiled, { filename: "app/page.tsx" }).runInNewContext({
    exports,
    process: {
      env: { ...options.environment, EDISON_ON_DEMAND_ENABLED: options.flag },
    },
    require(name: string) {
      switch (name) {
        case "react/jsx-runtime": return jsxRuntime;
        case "./reader": return { EdisonApp: PulseStub };
        case "@/components/edison/demand-reader": return { DemandReader: DemandStub };
        case "@/components/edison/brand": return { EdisonMark: BrandStub };
        case "@/lib/app-mode": return { getWebAppMode: () => options.mode };
        case "@/lib/supabase/server": return {
          createClient: async () => {
            clientCalls++;
            return { auth: { getClaims: async () => {
              authCalls++;
              return { data: { claims: options.claims } };
            } } };
          },
        };
        case "./demand.css": stylesheetImports++; return {};
        default: throw new Error(`Unexpected page dependency: ${name}`);
      }
    },
  });
  assert.equal(exports.dynamic, "force-dynamic");
  assert.equal(stylesheetImports, 1);
  assert.ok(exports.default);
  const element = await exports.default();
  return { element, authCalls, clientCalls };
}

test("live root renders the existing demand reader only for the exact server opt-in", async () => {
  const result = await home({ mode: "live", flag: "true" });
  assert.equal(result.element.type, DemandStub);
  assert.equal(Object.keys(result.element.props).length, 0);
  assert.equal(result.clientCalls, 0);
  assert.equal(result.authCalls, 0);
});

test("signed-in readers use the same demand root without a separate homepage auth prerequisite", async () => {
  const result = await home({
    mode: "live", flag: "true", claims: { sub: "owner-id", email: "owner@example.test" },
  });
  assert.equal(result.element.type, DemandStub);
  assert.equal(result.clientCalls, 0);
  assert.equal(result.authCalls, 0);
});

test("missing or non-exact opt-in preserves the existing live guest homepage", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes"]) {
    const { element, authCalls, clientCalls } = await home({ mode: "live", flag });
    assert.equal(element.type, PulseStub);
    assert.equal(element.props.dataMode, "guest");
    assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), { name: "", email: "" });
    assert.match(element.props.prototypeResearchedAt as string, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(clientCalls, 1);
    assert.equal(authCalls, 1);
  }
});

test("a public-looking flag cannot enable the demand root", async () => {
  const result = await home({
    mode: "live", environment: { NEXT_PUBLIC_EDISON_ON_DEMAND_ENABLED: "true" },
  });
  assert.equal(result.element.type, PulseStub);
  assert.equal(result.element.props.dataMode, "guest");
  assert.equal(result.authCalls, 1);
});

test("disabled demand preserves authenticated Pulse claims and display-name precedence", async () => {
  for (const [metadata, expectedName] of [
    [{ display_name: "Preferred", full_name: "Full Name" }, "Preferred"],
    [{ full_name: "Full Name" }, "Full Name"],
    [{}, "reader"],
  ] as const) {
    const { element, authCalls, clientCalls } = await home({
      mode: "live", flag: "false",
      claims: { sub: "reader-id", email: "reader@example.test", user_metadata: metadata },
    });
    assert.equal(element.type, PulseStub);
    assert.equal(element.props.dataMode, "live");
    assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), {
      id: "reader-id", name: expectedName, email: "reader@example.test",
    });
    assert.match(element.props.prototypeResearchedAt as string, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(clientCalls, 1);
    assert.equal(authCalls, 1);
  }
});

test("setup remains fail-closed even when demand was explicitly enabled", async () => {
  for (const flag of [undefined, "false", "true"]) {
    const { element, authCalls, clientCalls } = await home({ mode: "setup", flag });
    const html = renderToStaticMarkup(element);
    assert.match(html, /class="setup-page"/);
    assert.match(html, /Private setup/);
    assert.match(html, /Edison is almost ready\./);
    assert.match(html, /has not been connected yet/);
    assert.equal(clientCalls, 0);
    assert.equal(authCalls, 0);
  }
});

test("demo stays isolated and unchanged even when demand was explicitly enabled", async () => {
  for (const flag of [undefined, "false", "true"]) {
    const { element, authCalls, clientCalls } = await home({ mode: "demo", flag });
    assert.equal(element.type, PulseStub);
    assert.equal(element.props.dataMode, "prototype");
    assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), { name: "", email: "" });
    assert.match(element.props.prototypeResearchedAt as string, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(clientCalls, 0);
    assert.equal(authCalls, 0);
  }
});
