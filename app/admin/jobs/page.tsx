import { redirect } from "next/navigation";
import { AdminJobs } from "@/components/edison/admin-jobs";
import { isLiveAppConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/app-mode";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  if (isDemoMode() || !isLiveAppConfigured()) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/login");
  return <AdminJobs />;
}
