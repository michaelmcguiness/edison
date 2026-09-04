import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getPublicSupabaseConfig, isSupabaseConfigured } from "./env";
import { isDemoMode } from "../app-mode";

type CspOptions = {
  development?: boolean;
  apiUrl?: string;
  supabaseUrl?: string;
};

function connectionSource(rawUrl: string | undefined) {
  if (!rawUrl) return [];
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    const sources = [url.origin];
    if (url.protocol === "https:") {
      sources.push(`wss://${url.host}`);
    } else {
      sources.push(`ws://${url.host}`);
    }
    return sources;
  } catch {
    // A malformed environment value is handled by the normal setup checks.
    // It must never be interpolated into a response header.
    return [];
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  options: CspOptions = {},
) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error("A CSP nonce must be a base64-safe value.");
  }

  const development = options.development ?? process.env.NODE_ENV === "development";
  const configuredConnections = [
    ...connectionSource(options.apiUrl ?? process.env.NEXT_PUBLIC_API_URL),
    ...connectionSource(
      options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
  ];
  const developmentConnections = development
    ? [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "ws://localhost:*",
        "ws://127.0.0.1:*",
      ]
    : [];
  const connectSources = Array.from(
    new Set(["'self'", ...configuredConnections, ...developmentConnections]),
  ).join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "script-src-attr 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function updateSession(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);

  const nextResponse = () => {
    // Re-clone after Auth cookie refreshes so the upstream request receives
    // both the refreshed Cookie header and this response's security metadata.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  };

  if (isDemoMode() || !isSupabaseConfigured()) {
    return nextResponse();
  }

  const { url, publishableKey } = getPublicSupabaseConfig();
  let response = nextResponse();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = nextResponse();

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
