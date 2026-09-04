import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Usage: pnpm invite reader@example.com");
}

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const webUrl = process.env.WEB_APP_URL;

if (!supabaseUrl || !secretKey || !webUrl) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SECRET_KEY, and WEB_APP_URL must be configured.",
  );
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
  redirectTo: new URL("/auth/confirm", webUrl).toString(),
});

if (error) throw error;
console.log(`Invited ${data.user.email ?? email}.`);
