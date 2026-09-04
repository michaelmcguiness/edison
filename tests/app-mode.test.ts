import assert from "node:assert/strict";
import test from "node:test";
import { getWebAppMode, isDemoMode } from "../lib/app-mode";

const configurationKeys = [
  "NODE_ENV",
  "EDISON_DEMO_MODE",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

function withConfiguration(
  values: Partial<Record<(typeof configurationKeys)[number], string>>,
  run: () => void,
) {
  const environment: Record<string, string | undefined> = process.env;
  const previous = configurationKeys.map((key) => [key, environment[key]] as const);
  for (const key of configurationKeys) {
    if (values[key] === undefined) delete environment[key];
    else environment[key] = values[key];
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
}

const liveConfiguration = {
  NEXT_PUBLIC_API_URL: "https://api.example.test/v1",
  NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

test("hosted demo is explicitly enabled without backend configuration", () => {
  withConfiguration({ NODE_ENV: "production", EDISON_DEMO_MODE: "true" }, () => {
    assert.equal(isDemoMode(), true);
    assert.equal(getWebAppMode(), "demo");
  });
});

test("demo takes precedence over accidentally configured live services", () => {
  withConfiguration(
    { ...liveConfiguration, NODE_ENV: "production", EDISON_DEMO_MODE: "true" },
    () => assert.equal(getWebAppMode(), "demo"),
  );
});

test("unconfigured production never silently becomes a demo", () => {
  for (const flag of [undefined, "false", "1", "TRUE", "yes"]) {
    withConfiguration(
      { NODE_ENV: "production", ...(flag === undefined ? {} : { EDISON_DEMO_MODE: flag }) },
      () => {
        assert.equal(isDemoMode(), false);
        assert.equal(getWebAppMode(), "setup");
      },
    );
  }
});

test("local sample mode remains available without configuration", () => {
  withConfiguration({ NODE_ENV: "development" }, () => {
    assert.equal(getWebAppMode(), "demo");
  });
});

test("configured live deployment still requires the authenticated live path", () => {
  withConfiguration({ ...liveConfiguration, NODE_ENV: "production" }, () => {
    assert.equal(isDemoMode(), false);
    assert.equal(getWebAppMode(), "live");
  });
});

test("partial production configuration remains a setup state", () => {
  withConfiguration(
    { NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://api.example.test/v1" },
    () => assert.equal(getWebAppMode(), "setup"),
  );
});
