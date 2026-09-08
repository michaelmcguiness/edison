import { z } from "zod";

/** A selection of trusted editorial metaphors, never model-authored markup or
 * evidence. Version 1 preserves the three approved v11.1 compositions. */
export const demandArtDescriptorSchema = z.object({
  version: z.literal(1),
  composition: z.enum(["living-system", "built-space", "shared-network"]),
  palette: z.enum(["sage", "clay", "ink"]),
  variant: z.number().int().min(0).max(2),
}).strict();

export type DemandArtDescriptor = z.infer<typeof demandArtDescriptorSchema>;

/** Missing historical art and unsupported/invalid selections are text first.
 * In particular, never coerce an unknown subject to the nearest illustration. */
export function readDemandArtDescriptor(value: unknown): DemandArtDescriptor | null {
  const parsed = demandArtDescriptorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isDemandArtAvailable(value: unknown): value is DemandArtDescriptor {
  return demandArtDescriptorSchema.safeParse(value).success;
}
