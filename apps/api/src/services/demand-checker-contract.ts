import { READER_FIRST_CHECKER_CONTRACT_VERSION, type ReaderFirstCheckerOptions } from "@edison/ai";
import { HttpError } from "../http/errors";
import type { DemandRequestRow } from "./demand-reading";

type CheckerIdentity = Pick<DemandRequestRow, "kind" | "snapshot">;

/** Admission owns this selector. Absence is the frozen legacy contract, never
 * an instruction to upgrade an existing job to whichever checker is current. */
export function demandCheckerContractCompatibilityFailure(request: CheckerIdentity, state: Record<string, unknown>) {
  const snapshotHasVersion = Object.hasOwn(request.snapshot, "checkerContractVersion");
  const stateHasVersion = Object.hasOwn(state, "checkerContractVersion");
  const eligible = request.snapshot.version === 2 && ["article", "question"].includes(request.kind);
  if ((snapshotHasVersion && (!eligible || request.snapshot.checkerContractVersion !== READER_FIRST_CHECKER_CONTRACT_VERSION)) ||
    (stateHasVersion && (!eligible || state.checkerContractVersion !== READER_FIRST_CHECKER_CONTRACT_VERSION))) {
    return "pipeline_version_unsupported";
  }
  if (snapshotHasVersion !== stateHasVersion || request.snapshot.checkerContractVersion !== state.checkerContractVersion) {
    return "pipeline_state_invalid";
  }
  return null;
}

/** Keep the selector outside prose/evidence inputs and their exact fingerprints. */
export function demandCheckerOptions(request: CheckerIdentity, state: Record<string, unknown>): ReaderFirstCheckerOptions {
  const failure = demandCheckerContractCompatibilityFailure(request, state);
  if (failure) throw new HttpError(503, failure, "This explanation could not be safely prepared.");
  return Object.hasOwn(request.snapshot, "checkerContractVersion")
    ? { checkerContractVersion: READER_FIRST_CHECKER_CONTRACT_VERSION }
    : {};
}
