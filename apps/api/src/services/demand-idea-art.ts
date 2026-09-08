import { readDemandArtDescriptor } from "@edison/contracts";

/** Optional illustration metadata never blocks reading. Preserve valid and
 * historical absent values byte-for-byte; do not alter any editorial fields. */
export function demandReadableIdeaBrief(value: unknown): unknown {
  if(!value||typeof value!=="object"||Array.isArray(value)||!Object.hasOwn(value,"art")) return value;
  const brief=value as Record<string,unknown>;
  return brief.art===null||readDemandArtDescriptor(brief.art)!==null?value:{...brief,art:null};
}
