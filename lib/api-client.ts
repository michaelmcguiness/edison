"use client";

import { apiErrorSchema } from "@edison/contracts";
import { createClient } from "@/lib/supabase/client";

export class EdisonApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
  }) {
    super(input.message);
    this.name = "EdisonApiError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
  }
}

function apiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (!configured) {
    throw new EdisonApiError({
      code: "api_not_configured",
      message: "The Edison API URL has not been configured.",
      status: 503,
    });
  }
  return configured.replace(/\/$/, "");
}

export async function edisonApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new EdisonApiError({
      code: "authentication_required",
      message: "Your Edison session has expired. Please sign in again.",
      status: 401,
    });
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new EdisonApiError({
      code: parsed.success ? parsed.data.error.code : "request_failed",
      message: parsed.success
        ? parsed.data.error.message
        : "Edison could not complete that request.",
      requestId: parsed.success ? parsed.data.error.requestId : undefined,
      status: response.status,
    });
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The public reader has one deliberately narrow unauthenticated API surface.
 * Keep the prefix guard here so a future caller cannot accidentally turn this
 * helper into an unauthenticated client for private reader data.
 */
export async function edisonPublicApi<T>(path: string): Promise<T> {
  if (!path.startsWith("/public/") || path.includes("..")) {
    throw new EdisonApiError({
      code: "invalid_public_path",
      message: "That public Edison resource is not available.",
      status: 400,
    });
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new EdisonApiError({
      code: parsed.success ? parsed.data.error.code : "request_failed",
      message: parsed.success
        ? parsed.data.error.message
        : "Edison could not open the public edition.",
      requestId: parsed.success ? parsed.data.error.requestId : undefined,
      status: response.status,
    });
  }

  return (await response.json()) as T;
}
