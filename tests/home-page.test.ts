import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { WebAppMode } from "../lib/app-mode";
import { demandLoginPath } from "../lib/demand-auth-continuation";

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
type SearchParameters = Record<string, string | string[] | undefined>;
type Membership="member"|"signed_out"|"invite_required"|"unavailable";
class MemberRedirect extends Error {
  constructor(readonly location:string){super("Constructed member-gate redirect");}
}

// Execute the actual page branch logic without loading either client app or
// contacting Auth. Mode resolution itself is covered in app-mode.test.ts.
async function home(options: {
  mode: WebAppMode;
  flag?: string;
  claims?: Claims;
  environment?: Record<string, string>;
  query?: SearchParameters;
  searchParams?: Promise<SearchParameters>;
  membership?:Membership;
  trace?:string[];
}) {
  let authCalls = 0;
  let clientCalls = 0;
  let stylesheetImports = 0;
  const memberPaths:string[]=[];
  const exports: {
    default?: (props: { searchParams: Promise<SearchParameters> }) => Promise<ReactElement<Record<string, unknown>>>;
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
        case "@/lib/member-access": return {requireMemberSession:async(returnPath:string)=>{
          memberPaths.push(returnPath);options.trace?.push("membership");
          const status=options.membership??"member";
          if(status!=="member")throw new MemberRedirect(demandLoginPath(returnPath,status==="signed_out"?undefined:status));
          return {status:"member",accessToken:"constructed-verified-member-token"};
        }};
        case "@/lib/supabase/server": return {
          createClient: async () => {
            options.trace?.push("legacy-client");
            clientCalls++;
            return { auth: { getClaims: async () => {
              options.trace?.push("legacy-claims");
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
  const element = await exports.default({
    searchParams: options.searchParams ?? Promise.resolve(options.query ?? {}),
  });
  return { element, authCalls, clientCalls,memberPaths };
}

test("live root renders demand only after the member gate and exact server opt-in", async () => {
  const result = await home({ mode: "live", flag: "true" });
  assert.equal(result.element.type, DemandStub);
  assert.equal(Object.keys(result.element.props).length, 0);
  assert.equal(result.clientCalls, 0);
  assert.equal(result.authCalls, 0);
  assert.deepEqual(result.memberPaths,["/"]);
});

test("signed-in demand readers still require membership before receiving the reader", async () => {
  const result = await home({
    mode: "live", flag: "true", claims: { sub: "owner-id", email: "owner@example.test" },
  });
  assert.equal(result.element.type, DemandStub);
  assert.equal(result.clientCalls, 0);
  assert.equal(result.authCalls, 0);
  assert.deepEqual(result.memberPaths,["/"]);
});

test("the exact account Profile link awaits search parameters and retains authenticated Pulse controls", async () => {
  let resolveQuery!: (query: SearchParameters) => void;
  const trace:string[]=[];
  const pending = home({
    mode: "live", flag: "true",trace,
    claims: { sub: "owner-id", email: "owner@example.test", user_metadata: { display_name: "Owner" } },
    searchParams: new Promise((resolve) => { resolveQuery = resolve; }),
  });
  resolveQuery({ view: "profile" });
  const { element, authCalls, clientCalls } = await pending;
  assert.equal(element.type, PulseStub);
  assert.equal(element.props.dataMode, "live");
  assert.equal(element.props.returnHomeToDemand, true);
  assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), {
    id: "owner-id", name: "Owner", email: "owner@example.test",
  });
  assert.equal(clientCalls, 1);
  assert.equal(authCalls, 1);
  assert.deepEqual(trace,["membership","legacy-client","legacy-claims"]);
});

test("missing legacy Profile claims cannot invent an account after the separate member check", async () => {
  const { element, authCalls, clientCalls,memberPaths } = await home({
    mode: "live", flag: "true", query: { view: "profile" },
  });
  assert.equal(element.type, PulseStub);
  assert.equal(element.props.dataMode, "guest");
  assert.equal(element.props.returnHomeToDemand, true);
  assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), { name: "", email: "" });
  assert.equal(clientCalls, 1);
  assert.equal(authCalls, 1);
  assert.deepEqual(memberPaths,["/"]);
});

test("other, duplicated or additional query parameters cannot select the legacy reader while demand is enabled", async () => {
  for (const query of [
    {}, { view: "" }, { view: "Profile" }, { view: " profile" },
    { view: "home" }, { view: "library" }, { view: "article", article: "article-id" },
    { view: ["profile"] }, { view: ["profile", "profile"] }, { view: ["profile", "home"] },
    { view: "profile", section: "books" }, { view: "profile", article: "article-id" },
    { view: "profile", redirect: "https://example.test" },
  ] satisfies SearchParameters[]) {
    const { element, authCalls, clientCalls,memberPaths } = await home({ mode: "live", flag: "true", query });
    assert.equal(element.type, DemandStub);
    assert.equal(clientCalls, 0);
    assert.equal(authCalls, 0);
    assert.deepEqual(memberPaths,["/"]);
  }
});

test("the Profile query preserves post-gate claim fallbacks and isolated demo/setup behavior", async () => {
  for (const flag of [undefined, "false"]) {
    for (const claims of [undefined, { sub: "reader-id", email: "reader@example.test" }]) {
      const { element, authCalls,memberPaths } = await home({ mode: "live", flag, claims, query: { view: "profile" } });
      assert.equal(element.type, PulseStub);
      assert.equal(element.props.dataMode, claims ? "live" : "guest");
      assert.equal(element.props.returnHomeToDemand, false);
      assert.equal(authCalls, 1);
      assert.deepEqual(memberPaths,["/"]);
    }
  }
  for (const flag of [undefined, "false", "true"]) {
    const demo = await home({ mode: "demo", flag, query: { view: "profile" } });
    assert.equal(demo.element.type, PulseStub);
    assert.equal(demo.element.props.dataMode, "prototype");
    assert.equal(demo.element.props.returnHomeToDemand, undefined);
    assert.equal(demo.clientCalls, 0);
    assert.deepEqual(demo.memberPaths,[]);
    const setup = await home({ mode: "setup", flag, query: { view: "profile" } });
    assert.match(renderToStaticMarkup(setup.element), /Edison is almost ready\./);
    assert.equal(setup.clientCalls, 0);
    assert.deepEqual(setup.memberPaths,[]);
  }
});

test("missing or non-exact opt-in preserves the post-membership legacy fallback", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes"]) {
    const { element, authCalls, clientCalls,memberPaths } = await home({ mode: "live", flag });
    assert.equal(element.type, PulseStub);
    assert.equal(element.props.dataMode, "guest");
    assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), { name: "", email: "" });
    assert.match(element.props.prototypeResearchedAt as string, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(clientCalls, 1);
    assert.equal(authCalls, 1);
    assert.deepEqual(memberPaths,["/"]);
  }
});

test("a public-looking flag cannot enable the demand root", async () => {
  const result = await home({
    mode: "live", environment: { NEXT_PUBLIC_EDISON_ON_DEMAND_ENABLED: "true" },
  });
  assert.equal(result.element.type, PulseStub);
  assert.equal(result.element.props.dataMode, "guest");
  assert.equal(result.authCalls, 1);
  assert.deepEqual(result.memberPaths,["/"]);
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
    const { element, authCalls, clientCalls,memberPaths } = await home({ mode: "setup", flag,membership:"unavailable" });
    const html = renderToStaticMarkup(element);
    assert.match(html, /class="setup-page"/);
    assert.match(html, /Private setup/);
    assert.match(html, /Edison is almost ready\./);
    assert.match(html, /has not been connected yet/);
    assert.equal(clientCalls, 0);
    assert.equal(authCalls, 0);
    assert.deepEqual(memberPaths,[]);
  }
});

test("demo stays isolated and unchanged even when demand was explicitly enabled", async () => {
  for (const flag of [undefined, "false", "true"]) {
    const { element, authCalls, clientCalls,memberPaths } = await home({ mode: "demo", flag,membership:"invite_required" });
    assert.equal(element.type, PulseStub);
    assert.equal(element.props.dataMode, "prototype");
    assert.deepEqual(JSON.parse(JSON.stringify(element.props.reader)), { name: "", email: "" });
    assert.match(element.props.prototypeResearchedAt as string, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(clientCalls, 0);
    assert.equal(authCalls, 0);
    assert.deepEqual(memberPaths,[]);
  }
});

test("signed-out, nonmember and failed membership checks prevent every live content branch",async()=>{
  for(const membership of ["signed_out","invite_required","unavailable"] as const)
    for(const flag of [undefined,"false","true"])
      for(const query of [{},{view:"profile"}] satisfies SearchParameters[]) {
        const trace:string[]=[];
        await assert.rejects(home({mode:"live",flag,membership,query,trace,
          claims:{sub:"signed-in-but-not-admitted",email:"reader@example.test"}}),
        e=>e instanceof MemberRedirect&&e.location===demandLoginPath("/",membership==="signed_out"?undefined:membership));
        assert.deepEqual(trace,["membership"],"no legacy auth/profile/content work follows failed membership");
      }
});

test("member gate preserves a valid exact idea destination through sign-in",async()=>{
  const idea="11111111-1111-4111-8111-111111111111",path=`/?idea=${idea}`;
  const admitted=await home({mode:"live",flag:"true",query:{idea}});
  assert.equal(admitted.element.type,DemandStub);assert.deepEqual(admitted.memberPaths,[path]);
  const trace:string[]=[];
  await assert.rejects(home({mode:"live",flag:"true",query:{idea},membership:"signed_out",trace}),
    e=>e instanceof MemberRedirect&&new URL(e.location,"https://example.test").searchParams.get("next")===path);
  assert.deepEqual(trace,["membership"]);
  for(const query of [{idea:[idea,idea]},{idea:"https://example.test/private"}] satisfies SearchParameters[])
    await assert.rejects(home({mode:"live",flag:"true",query,membership:"signed_out"}),e=>e instanceof MemberRedirect&&e.location==="/login");
});
