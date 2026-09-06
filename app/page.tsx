import { EdisonApp } from "./reader";
import { getWebAppMode } from "@/lib/app-mode";
import { createClient } from "@/lib/supabase/server";
import { EdisonMark } from "@/components/edison/brand";
import { DemandReader } from "@/components/edison/demand-reader";
import "./demand.css";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const mode = getWebAppMode();
  let returnHomeToDemand = false;
  if (mode === "live" && process.env.EDISON_ON_DEMAND_ENABLED === "true") {
    const query = await searchParams;
    // Preserve the existing account link without opening a general legacy-view
    // switch. Its normal Auth check and guest restrictions still apply below.
    const accountProfile = query.view === "profile" && Object.keys(query).length === 1;
    if (!accountProfile) return <DemandReader />;
    returnHomeToDemand = true;
  }

  if (mode !== "live") {
    if (mode === "setup") {
      return (
        <main className="setup-page">
          <section className="setup-card">
            <EdisonMark className="onboarding-mark" />
            <span className="eyebrow">Private setup</span>
            <h1>Edison is almost ready.</h1>
            <p>
              The application is deployed, but its private Supabase environment
              has not been connected yet.
            </p>
          </section>
        </main>
      );
    }

    return (
      <EdisonApp
        reader={{ name: "", email: "" }}
        dataMode="prototype"
        prototypeResearchedAt={new Date().toISOString()}
      />
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const requestedAt = new Date().toISOString();

  // Ready public reading is intentionally available before authentication.
  // Private API calls remain bearer-authenticated in the client.
  if (!data?.claims) {
    return (
      <EdisonApp
        reader={{ name: "", email: "" }}
        dataMode="guest"
        returnHomeToDemand={returnHomeToDemand}
        prototypeResearchedAt={requestedAt}
      />
    );
  }

  const claims = data.claims as {
    sub?: string;
    email?: string;
    user_metadata?: { display_name?: string; full_name?: string };
  };
  const email = claims.email ?? "";
  const name =
    claims.user_metadata?.display_name ??
    claims.user_metadata?.full_name ??
    email.split("@")[0] ?? "";

  return (
    <EdisonApp
      reader={{ id: claims.sub, name, email }}
      dataMode="live"
      returnHomeToDemand={returnHomeToDemand}
      prototypeResearchedAt={requestedAt}
    />
  );
}
