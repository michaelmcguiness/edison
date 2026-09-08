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
  demandArticleResultSchema, demandConversationSchema, demandConversationQuerySchema,
  createDemandArticleShareSchema, demandArticleShareReceiptSchema,
  editDemandLoopSchema, archiveDemandLoopSchema, type EditDemandLoop, type ArchiveDemandLoop,
  requestDemandArticleSchema,
  requestDemandIdeasSchema,
  resetDemandAllowanceSchema, demandAllowanceResetReceiptSchema, type ResetDemandAllowance,
  demandLoopsQuerySchema, demandLoopsSchema, type DemandLoopsQuery,
  demandInvitationsSchema, createDemandInvitationSchema, demandInvitationActionSchema, demandInvitationMutationSchema,
  type CreateDemandInvitation, type DemandInvitationAction,
  uuidSchema,
  type DemandResult,
  type DemandWorkspace,
  type DemandHistoryQuery,
  type DemandConversationQuery,
} from "@edison/contracts";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  demandLoginPath,
  saveDemandAccountContinuation,
  takeDemandAccountContinuation,
  type DemandAccountIntent,
} from "@/lib/demand-auth-continuation";
export type { DemandAccountIntent } from "@/lib/demand-auth-continuation";

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
let accountSessionPromise: Promise<DemandWorkspace> | null = null;

export async function getDemandInvitations() {
  return demandInvitationsSchema.parse(await demandFetch("invitations"));
}
export async function sendDemandInvitation(input: CreateDemandInvitation) {
  return demandInvitationMutationSchema.parse(await demandFetch("invitations", { method: "POST", body: JSON.stringify(createDemandInvitationSchema.parse(input)) }));
}
export async function resendDemandInvitation(id: string, input: DemandInvitationAction) {
  return demandInvitationMutationSchema.parse(await demandFetch(`invitations/${uuidSchema.parse(id)}/resend`, { method: "POST", body: JSON.stringify(demandInvitationActionSchema.parse(input)) }));
}
export async function revokeDemandInvitation(id: string, input: DemandInvitationAction) {
  return demandInvitationMutationSchema.parse(await demandFetch(`invitations/${uuidSchema.parse(id)}/revoke`, { method: "POST", body: JSON.stringify(demandInvitationActionSchema.parse(input)) }));
}

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

/** Explicit user recovery only: open the verified account without claiming
 * this browser's guest history. The server retains its cookie on failure. */
export function startDemandAccountSession() {
  if (!accountSessionPromise) {
    accountSessionPromise = demandFetch("session", {
      method: "POST", body: JSON.stringify({ continueWithAccount: true }),
    }).then((payload) => {
      const workspace = workspaceEnvelope(payload);
      if (workspace.readerKind !== "account") {
        throw new DemandClientError({ code: "invalid_response", status: 502,
          message: "Edison could not confirm your account workspace. Please try again." });
      }
      return workspace;
    }).finally(() => { accountSessionPromise = null; });
  }
  return accountSessionPromise;
}

export function beginDemandAccountFlow(intent: DemandAccountIntent) {
  // An expiring nonce permits a magic link to open in another tab of this same
  // browser without putting the private curiosity in a URL or an auth email.
  let returnPath: string;
  try {
    returnPath = saveDemandAccountContinuation({
      intent, id: crypto.randomUUID(), storage: window.localStorage,
    });
  } catch {
    // Do not silently discard the draft when browser storage is unavailable.
    throw new DemandClientError({ code: "continuation_unavailable", status: 503,
      message: "Your browser couldn’t save this draft for sign-in. Keep it here and try again." });
  }
  window.location.assign(demandLoginPath(returnPath));
}

/** Call only after the server has returned an account-owned workspace. */
export function readDemandAccountContinuation() {
  if (typeof window === "undefined") return null;
  try {
    const intent = takeDemandAccountContinuation({
      returnPath: `${window.location.pathname}${window.location.search}`, storage: window.localStorage,
    });
    if (intent) {
      // URL cleanup is cosmetic; a browser history failure must not lose the
      // already recovered draft after its storage record was consumed.
      try { window.history.replaceState(window.history.state, "", "/"); } catch { /* Keep the recovered intent. */ }
    }
    return intent;
  } catch { return null; }
}

export async function getDemandAccountIdentity(): Promise<{ email: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await createClient().auth.getUser();
    if (error) throw sessionUnavailableError();
    const user = data.user;
    if (!user || user.is_anonymous || !user.email || !user.email_confirmed_at) return null;
    return { email: user.email };
  } catch { throw sessionUnavailableError(); }
}

export async function signOutDemandAccount() {
  if (!isSupabaseConfigured()) throw sessionUnavailableError();
  const { error } = await createClient().auth.signOut({ scope: "local" });
  if (error) throw new DemandClientError({ code: "sign_out_failed", status: 503,
    message: "Edison couldn’t sign you out. Please try again." });
  sessionPromise = null;
}

export async function getDemandWorkspace() {
  return workspaceEnvelope(await demandFetch("workspace"));
}

export async function getDemandLoops(input: DemandLoopsQuery = {}) {
  const query = demandLoopsQuerySchema.parse(input);
  const suffix = query.cursor ? `?${new URLSearchParams({ cursor: query.cursor })}` : "";
  const result = demandLoopsSchema.safeParse(await demandFetch(`loops${suffix}`));
  if (!result.success) throw new DemandClientError({ code: "invalid_response", status: 502,
    message: "Edison couldn’t load those loops. Your existing reading is still available." });
  return result.data;
}

export async function getDemandLoop(loopId: string) {
  const result = demandLoopsSchema.safeParse(await demandFetch(`loops/${uuidSchema.parse(loopId)}`));
  if (!result.success) throw new DemandClientError({ code: "invalid_response", status: 502,
    message: "Edison couldn’t load that loop. Your existing reading is still available." });
  return result.data;
}

export async function resetDemandAllowance(input: ResetDemandAllowance) {
  const body = resetDemandAllowanceSchema.parse(input);
  const payload = await demandFetch("allowance/reset", { method: "POST", body: JSON.stringify(body) });
  const workspace = workspaceEnvelope(payload);
  const receipt = demandAllowanceResetReceiptSchema.safeParse(payload?.receipt);
  if (!receipt.success) throw new DemandClientError({ code: "invalid_response", status: 502,
    message: "Edison couldn’t confirm the allowance reset. Retry this same request." });
  return { workspace, receipt: receipt.data };
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

export async function getDemandArticle(articleId: string) {
  return demandArticleResultSchema.parse(await demandFetch(`articles/${uuidSchema.parse(articleId)}`));
}

export async function getDemandConversation(articleId: string, input: DemandConversationQuery = {}) {
  const query = demandConversationQuerySchema.parse(input);
  const suffix = query.cursor ? `?${new URLSearchParams({ cursor: query.cursor })}` : "";
  return demandConversationSchema.parse(await demandFetch(`articles/${uuidSchema.parse(articleId)}/conversation${suffix}`));
}

export async function createDemandShare(articleId: string, input: { idempotencyKey: string; confirmPublic: true }) {
  const body = createDemandArticleShareSchema.parse(input);
  const receipt = demandArticleShareReceiptSchema.parse(await demandFetch(`articles/${uuidSchema.parse(articleId)}/share`, {
    method: "POST", body: JSON.stringify(body),
  }));
  return { url: `https://edisonreader.com/s/demand/${receipt.token}`, shareId: receipt.token, articleVersion: articleId };
}

export async function editDemandLoop(loopId: string, input: EditDemandLoop) {
  const body = editDemandLoopSchema.parse(input);
  return mutationEnvelope(await demandFetch(`loops/${uuidSchema.parse(loopId)}/edit`, { method: "POST", body: JSON.stringify(body) }));
}

export async function deleteDemandLoop(loopId: string, input: ArchiveDemandLoop) {
  const body = archiveDemandLoopSchema.parse(input);
  return mutationEnvelope(await demandFetch(`loops/${uuidSchema.parse(loopId)}/archive`, { method: "POST", body: JSON.stringify(body) }));
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
