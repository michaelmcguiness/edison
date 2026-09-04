export type FeedCursor = {
  editionDate: string;
  rank: string;
  id: string;
};

export function encodeFeedCursor(cursor: FeedCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeFeedCursor(value: string): FeedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_feed_cursor");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("editionDate" in parsed) ||
    !("rank" in parsed) ||
    !("id" in parsed) ||
    typeof parsed.editionDate !== "string" ||
    typeof parsed.rank !== "string" ||
    typeof parsed.id !== "string"
  ) {
    throw new Error("invalid_feed_cursor");
  }

  try {
    dateKeyToEpochDay(parsed.editionDate);
  } catch {
    throw new Error("invalid_feed_cursor");
  }
  if (!/^\d{1,14}(?:\.\d{1,6})?$/.test(parsed.rank)) {
    throw new Error("invalid_feed_cursor");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed.id,
    )
  ) {
    throw new Error("invalid_feed_cursor");
  }

  return {
    editionDate: parsed.editionDate,
    rank: parsed.rank,
    id: parsed.id,
  };
}

function dateKeyToEpochDay(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error("invalid_date_key");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new Error("invalid_date_key");
  }
  return Math.floor(instant.getTime() / 86_400_000);
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dailyEditionTimeInZone(date: Date, timeZone: string) {
  try {
    const hourPart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value;
    const hour = Number(hourPart);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

    return {
      dateKey: dateKeyInTimeZone(date, timeZone),
      hour,
    };
  } catch {
    // A malformed stored timezone must not prevent other readers' editions.
    return null;
  }
}

export function dailyEditionIdempotencyKey(dateKey: string, slot: number) {
  return `daily-edition:${dateKey}:slot:${slot}`;
}

export function nextReadingStreak(input: {
  currentStreak: number;
  lastReadDate: string | null;
  readDate: string;
}) {
  if (!input.lastReadDate) {
    return { currentStreak: 1, lastReadDate: input.readDate };
  }

  const difference =
    dateKeyToEpochDay(input.readDate) - dateKeyToEpochDay(input.lastReadDate);

  if (difference <= 0) {
    return {
      currentStreak: input.currentStreak,
      lastReadDate: input.lastReadDate,
    };
  }

  return {
    currentStreak: difference === 1 ? input.currentStreak + 1 : 1,
    lastReadDate: input.readDate,
  };
}

export function slugifyArticleTitle(title: string) {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);

  return base || "edison-article";
}

export function estimatedArticleCostMicrousd(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
}) {
  const prices = openAiModelTokenPrices(input.model);

  const uncachedTokens = Math.max(0, input.inputTokens - input.cachedInputTokens);
  const tokenDollars =
    (uncachedTokens * prices.input +
      input.cachedInputTokens * prices.cached +
      input.outputTokens * prices.output) /
    1_000_000;

  // Keep tool pricing separately configurable in the usage pipeline. Returning
  // only the token subtotal is safer than silently baking in a stale search fee.
  return Math.round(tokenDollars * 1_000_000);
}

const pricedOpenAiModels = [
  {
    pattern: /^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/,
    prices: { input: 0.2, cached: 0.02, output: 1.2 },
  },
  {
    pattern: /^gpt-5\.6-terra(?:-\d{4}-\d{2}-\d{2})?$/,
    prices: { input: 2, cached: 0.2, output: 12 },
  },
] as const;

export function isPricedOpenAiModel(model: string) {
  return pricedOpenAiModels.some(({ pattern }) => pattern.test(model));
}

export class UnpricedOpenAiModelError extends RangeError {
  constructor(readonly model: string) {
    super(`unpriced_openai_model:${model}`);
    this.name = "UnpricedOpenAiModelError";
  }
}

function openAiModelTokenPrices(model: string) {
  const priced = pricedOpenAiModels.find(({ pattern }) => pattern.test(model));
  if (!priced) {
    throw new UnpricedOpenAiModelError(model);
  }
  return priced.prices;
}

export type InterestSignal = {
  id?: string;
  topic: string;
  status: string;
};

export function normalizeInterestTopic(topic: string) {
  return topic.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function partitionInterestSignals(interests: InterestSignal[]) {
  const active = new Map<string, string>();
  const muted = new Map<string, string>();

  for (const interest of interests) {
    const key = normalizeInterestTopic(interest.topic);
    if (!key) continue;
    if (interest.status === "active" && !active.has(key)) {
      active.set(key, interest.topic);
    }
    if (interest.status === "muted" && !muted.has(key)) {
      muted.set(key, interest.topic);
    }
  }

  return {
    active: [...active.values()],
    muted: [...muted.values()],
  };
}

export function resolveActiveInterestRemoval(
  requestedTopics: string[],
  interests: InterestSignal[],
) {
  const requestedKeys = new Set(
    requestedTopics.map(normalizeInterestTopic).filter(Boolean),
  );
  const ids = new Set<string>();
  const topics = new Map<string, string>();

  for (const interest of interests) {
    const key = normalizeInterestTopic(interest.topic);
    if (interest.status !== "active" || !requestedKeys.has(key)) continue;
    if (interest.id) ids.add(interest.id);
    if (!topics.has(key)) topics.set(key, interest.topic);
  }

  return { ids: [...ids], topics: [...topics.values()] };
}
