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
