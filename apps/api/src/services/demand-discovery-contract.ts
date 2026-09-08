import { READER_FIRST_DISCOVERY_CONTRACT_VERSION, type ReaderFirstDiscoveryContractVersion } from "@edison/ai";
import { HttpError } from "../http/errors";
import type { DemandRequestRow } from "./demand-reading";

type DiscoveryIdentity = Pick<DemandRequestRow, "kind" | "snapshot">;
type DiscoveryOptions = { discoveryContractVersion?: ReaderFirstDiscoveryContractVersion };

/** New article admission owns this selector. Missing means frozen legacy;
 * existing requests must not acquire new discovery behavior during replay. */
export function demandDiscoveryContractCompatibilityFailure(request: DiscoveryIdentity, state: Record<string, unknown>) {
  const snapshotHasVersion = Object.hasOwn(request.snapshot, "discoveryContractVersion");
  const stateHasVersion = Object.hasOwn(state, "discoveryContractVersion");
  const eligible = request.snapshot.version === 2 && request.kind === "article";
  if ((snapshotHasVersion && (!eligible || request.snapshot.discoveryContractVersion !== READER_FIRST_DISCOVERY_CONTRACT_VERSION)) ||
    (stateHasVersion && (!eligible || state.discoveryContractVersion !== READER_FIRST_DISCOVERY_CONTRACT_VERSION))) {
    return "pipeline_version_unsupported";
  }
  if (snapshotHasVersion !== stateHasVersion || request.snapshot.discoveryContractVersion !== state.discoveryContractVersion) {
    return "pipeline_state_invalid";
  }
  return null;
}

/** Keep compatibility identity outside the retained prose/evidence packet. */
export function demandDiscoveryOptions(request: DiscoveryIdentity, state: Record<string, unknown>): DiscoveryOptions {
  const failure = demandDiscoveryContractCompatibilityFailure(request, state);
  if (failure) throw new HttpError(503, failure, "This explanation could not be safely prepared.");
  return Object.hasOwn(request.snapshot, "discoveryContractVersion")
    ? { discoveryContractVersion: READER_FIRST_DISCOVERY_CONTRACT_VERSION }
    : {};
}
