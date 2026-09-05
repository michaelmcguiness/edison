import { z } from "zod";

export const readerLoopIdSchema = z.union([z.enum(["for-you", "collection"]), z.string().uuid()]);

export const readingJourneySchema = z.object({
  loopId: readerLoopIdSchema,
  articleIds: z.array(z.string().uuid()).max(60),
  returnArticleId: z.string().uuid().nullable(),
  feedScrollY: z.number().finite().min(0).max(1_000_000),
}).strict();

export type ReadingJourney = z.infer<typeof readingJourneySchema>;

/** URLs contain opaque IDs only, never a curiosity, question or direction. */
export function validReaderLoopId(value: unknown): string | undefined {
  const result = readerLoopIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function createReadingJourney(
  loopId: string,
  articleIds: string[],
  returnArticleId: string,
  feedScrollY: number,
): ReadingJourney {
  return readingJourneySchema.parse({
    loopId,
    articleIds: [...new Set(articleIds)].slice(0, 60),
    returnArticleId,
    feedScrollY: Math.max(0, feedScrollY),
  });
}

/** An unavailable article never becomes a misleading Next destination. */
export function nextReadableArticle<T extends { id: string }>(
  currentId: string,
  journey: ReadingJourney | null,
  readable: T[],
): T | null {
  if (!journey) return null;
  const index = journey.articleIds.indexOf(currentId);
  if (index < 0) return null;
  const byId = new Map(readable.map((item) => [item.id, item]));
  for (const id of journey.articleIds.slice(index + 1)) {
    const article = byId.get(id);
    if (article) return article;
  }
  return null;
}

export function continuityStorageKey(identity?: string | null): string {
  return `edison:reading-continuity:v1:${identity ? `account:${encodeURIComponent(identity)}` : "guest"}`;
}

const positionSchema = z.object({
  blockId: z.string().max(160).nullable(),
  offset: z.number().finite().min(-100_000).max(100_000),
  scrollY: z.number().finite().min(0).max(1_000_000),
}).strict();

export const continuitySchema = z.object({
  version: z.literal(1),
  journeys: z.record(z.string().uuid(), readingJourneySchema).refine((items) => Object.keys(items).length <= 60),
  positions: z.record(z.string().max(200), positionSchema).refine((items) => Object.keys(items).length <= 100),
  questionDrafts: z.record(z.string().uuid(), z.string().max(4000)).refine((items) => Object.keys(items).length <= 60),
}).strict();

export type ReaderContinuity = z.infer<typeof continuitySchema>;
export type ReadingPosition = z.infer<typeof positionSchema>;
export const emptyReaderContinuity = (): ReaderContinuity => ({ version: 1, journeys: {}, positions: {}, questionDrafts: {} });

export function readReaderContinuity(raw: string | null): ReaderContinuity {
  if (!raw) return emptyReaderContinuity();
  try {
    return continuitySchema.parse(JSON.parse(raw));
  } catch {
    return emptyReaderContinuity();
  }
}

export function boundedRecord<T>(record: Record<string, T>, key: string, value: T, limit: number): Record<string, T> {
  const entries = Object.entries(record).filter(([candidate]) => candidate !== key);
  return Object.fromEntries([...entries.slice(-(limit - 1)), [key, value]]);
}
