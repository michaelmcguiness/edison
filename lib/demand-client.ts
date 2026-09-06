"use client";

import {
  apiErrorSchema,
  createDemandLoopSchema,
  demandEventSchema,
  demandFeedbackSchema,
  demandQuestionSchema,
  demandResultSchema,
  demandWorkspaceSchema,
  demandHistoryQuerySchema,
  demandHistorySchema,
  demandIdeaResultSchema,
  requestDemandArticleSchema,
  requestDemandIdeasSchema,
  uuidSchema,
  type DemandResult,
  type DemandWorkspace,
  type DemandHistoryQuery,
} from "@edison/contracts";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export class DemandClientError extends Error {
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
    this.name = "DemandClientError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
  }
}

export type DemandMutationResponse = {
  workspace: DemandWorkspace;
  requestId?: string;
};

let sessionPromise: Promise<DemandWorkspace> | null = null;

type DemandSessionRead = {
  data: {
    session: {
      access_token?: string | null;
    } | null;
  };
  error: unknown;
};

function sessionUnavailableError() {
  return new DemandClientError({
    code: "session_unavailable",
    message: "Edison could not verify your sign-in. Please try again.",
    status: 503,
  });
}

export async function resolveDemandAccessToken(input: {
  configured: boolean;
  getSession: () => Promise<DemandSessionRead>;
}) {
  if (!input.configured) return null;

  let result: DemandSessionRead;
  try {
    result = await input.getSession();
  } catch {
    throw sessionUnavailableError();
  }

  if (result.error) throw sessionUnavailableError();
  return result.data.session?.access_token ?? null;
}

async function optionalAccessToken() {
  return resolveDemandAccessToken({
    configured: isSupabaseConfigured(),
    getSession: () => createClient().auth.getSession(),
  });
}

async function demandFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const accessToken = await optionalAccessToken();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`/api/demand/${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new DemandClientError({
      code: parsed.success ? parsed.data.error.code : "request_failed",
      message: parsed.success
        ? parsed.data.error.message
        : "Edison could not complete that request.",
      requestId: parsed.success ? parsed.data.error.requestId : undefined,
      status: response.status,
    });
  }
  return payload;
}

function workspaceEnvelope(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("workspace" in payload)) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading workspace.",
      status: 502,
    });
  }
  const parsed = demandWorkspaceSchema.safeParse(payload.workspace);
  if (!parsed.success) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading workspace.",
      status: 502,
    });
  }
  return parsed.data;
}

function mutationEnvelope(payload: unknown): DemandMutationResponse {
  if (!payload || typeof payload !== "object" || !("workspace" in payload)) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading update.",
      status: 502,
    });
  }
  const requestId = "requestId" in payload ? payload.requestId : undefined;
  if (requestId !== undefined && !uuidSchema.safeParse(requestId).success) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading request.",
      status: 502,
    });
  }
  const workspace = demandWorkspaceSchema.safeParse(payload.workspace);
  if (!workspace.success) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading update.",
      status: 502,
    });
  }
  return {
    workspace: workspace.data,
    ...(typeof requestId === "string" ? { requestId } : {}),
  };
}

export function startDemandSession() {
  if (!sessionPromise) {
    sessionPromise = demandFetch("session", { method: "POST" })
      .then((payload) => {
        const workspace = workspaceEnvelope(payload);
        sessionPromise = null;
        return workspace;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  }
  return sessionPromise;
}

export async function getDemandWorkspace() {
  return workspaceEnvelope(await demandFetch("workspace"));
}

export async function getDemandHistory(input: Partial<DemandHistoryQuery> = {}) {
  const query = demandHistoryQuerySchema.parse(input);
  const params = new URLSearchParams({ scope: query.scope });
  if (query.loopId) params.set("loopId", query.loopId);
  if (query.cursor) params.set("cursor", query.cursor);
  const result = demandHistorySchema.safeParse(await demandFetch(`history?${params}`));
  if (!result.success) throw new DemandClientError({
    code: "invalid_response", message: "Edison returned invalid reading history.", status: 502,
  });
  return result.data;
}

export async function getDemandIdea(ideaId: string) {
  const result = demandIdeaResultSchema.safeParse(await demandFetch(`ideas/${uuidSchema.parse(ideaId)}`));
  if (!result.success) throw new DemandClientError({
    code: "invalid_response", message: "Edison returned an invalid article idea.", status: 502,
  });
  return result.data;
}

export async function createDemandLoop(input: {
  curiosity: string;
  idempotencyKey: string;
}) {
  const body = createDemandLoopSchema.parse(input);
  return mutationEnvelope(
    await demandFetch("loops", { method: "POST", body: JSON.stringify(body) }),
  );
}

export async function requestDemandIdeas(
  loopId: string,
  input: { baseRevision: number; idempotencyKey: string },
) {
  const body = requestDemandIdeasSchema.parse(input);
  return mutationEnvelope(
    await demandFetch(`loops/${uuidSchema.parse(loopId)}/ideas`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function requestDemandArticle(
  ideaId: string,
  input: { idempotencyKey: string },
) {
  const body = requestDemandArticleSchema.parse(input);
  return mutationEnvelope(
    await demandFetch(`ideas/${uuidSchema.parse(ideaId)}/article`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function getDemandResult(requestId: string): Promise<DemandResult> {
  const result = demandResultSchema.safeParse(
    await demandFetch(`requests/${uuidSchema.parse(requestId)}`),
  );
  if (!result.success) {
    throw new DemandClientError({
      code: "invalid_response",
      message: "Edison returned an invalid reading result.",
      status: 502,
    });
  }
  return result.data;
}

export async function retryDemandRequest(requestId: string) {
  return mutationEnvelope(
    await demandFetch(`requests/${uuidSchema.parse(requestId)}/retry`, {
      method: "POST",
    }),
  );
}

export async function applyDemandFeedback(
  loopId: string,
  input:
    | {
        operation: "apply";
        text: string;
        baseRevision: number;
        idempotencyKey: string;
      }
    | {
        operation: "undo";
        mutationId: string;
        baseRevision: number;
        idempotencyKey: string;
      },
) {
  const body = demandFeedbackSchema.parse(input);
  return mutationEnvelope(
    await demandFetch(`loops/${uuidSchema.parse(loopId)}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function askDemandQuestion(
  ideaId: string,
  input: { question: string; idempotencyKey: string },
) {
  const body = demandQuestionSchema.parse(input);
  return mutationEnvelope(
    await demandFetch(`ideas/${uuidSchema.parse(ideaId)}/questions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function updateDemandIdeaEvent(
  ideaId: string,
  input:
    | { type: "opened"; idempotencyKey: string }
    | { type: "saved"; saved: boolean; idempotencyKey: string }
    | { type: "progress"; progress: number; idempotencyKey: string },
) {
  const body = demandEventSchema.parse(input);
  return mutationEnvelope(
    await demandFetch(`ideas/${uuidSchema.parse(ideaId)}/events`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
}
