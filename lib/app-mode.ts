import { isLiveAppConfigured } from "./supabase/env";

export type WebAppMode = "demo" | "live" | "setup";

// Server-selected only: URL parameters and browser state cannot enable a demo
// on a live deployment. Missing production configuration still fails closed.
export function isDemoMode() {
  return process.env.EDISON_DEMO_MODE === "true";
}

export function getWebAppMode(): WebAppMode {
  if (isDemoMode()) return "demo";
  if (isLiveAppConfigured()) return "live";
  return process.env.NODE_ENV === "production" ? "setup" : "demo";
}
