import { zodTextFormat } from "openai/helpers/zod";
import type { ArticleCategory } from "@edison/contracts";
import { getArticleModel, getOpenAIClient } from "./client";
import {
  generatedArticleFormatSchema,
  generatedArticleSchema,
  type GeneratedArticle,
} from "./schemas";

export type ArticleGenerationContext = {
  userId: string;
  requestedTopic?: string;
  goals: string[];
  interests: string[];
  mutedInterests: string[];
  knowledgeState: unknown[];
  recentTitles: string[];
  preferredLength: "brief" | "standard" | "deep";
  depth: number;
  novelty: number;
  requestedCategory?: ArticleCategory;
  allowedCategories: ArticleCategory[];
  edition?: {
    date: string;
    slot: number;
    target: number;
  };
};

export type ArticleGenerationResult = {
  article: GeneratedArticle;
  providerResponseId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
};

const editorialInstructions = `
You are Edison, the editor and writer of a private personalized publication.
Write one original, rigorous article for the reader. The article must feel
like a beautifully edited magazine feature, not an AI response or a listicle.

Everything except "whyWritten" must be safe to publish anonymously: never name,
address, identify, or describe the reader, and never repeat private profile or
goal wording. Personalization should affect topic selection, depth, and framing,
not appear as personal facts in the title, deck, body, summary, kicker, or topic.

Treat muted interests as negative editorial signals. Unless the reader's current
explicit request requires one, do not select a story whose central subject is a
muted topic, and reduce incidental coverage of those topics where practical.

Set the output category to one of the supplied allowed categories. When a
requested category is supplied, use exactly that category.

Research the subject with web search before writing. Prefer primary documents,
peer-reviewed research, official data, and strong reporting. Resolve conflicts
and distinguish facts from uncertainty. Synthesize; never reproduce meaningful
passages from a source. Every specific, externally verifiable factual claim must
carry one or more source keys in its paragraph. Every source URL in the output
must be a URL you actually used through web search.

The three summary bullets must be concrete and useful. "whyWritten" must explain
the specific connection to the supplied reader context without exposing private
details that would feel invasive. Do not mention prompts, tokens, personalization
algorithms, or that you are a language model. Do not fabricate quotes. Use a quote
block only for a short, accurately attributed quotation supported by a source.
`.trim();

const editionLanes = [
  "Lead story: favor a timely, consequential subject with clear relevance to the reader.",
  "Deep-learning story: favor a durable idea, system, or scientific question worth understanding.",
  "Discovery story: favor a surprising subject from history, biography, culture, or an adjacent field.",
  "Frontier story: favor an emerging development whose implications are not yet widely understood.",
] as const;

function editionAssignment(context: ArticleGenerationContext) {
  if (context.requestedTopic) return `Write about: ${context.requestedTopic}`;
  if (!context.edition) {
    return "Choose the single most valuable subject for this reader today.";
  }

  const lane = editionLanes[(context.edition.slot - 1) % editionLanes.length];
  return [
    `Choose story ${context.edition.slot} of ${context.edition.target} for the reader's ${context.edition.date} edition.`,
    lane,
    "Treat the numbered slot as a distinct editorial assignment so the edition spans different subjects and angles.",
  ].join(" ");
}

export function buildArticleGenerationInput(
  context: ArticleGenerationContext,
  currentDate = context.edition?.date ?? new Date().toISOString().slice(0, 10),
) {
  return {
    assignment: editionAssignment(context),
    reader: {
      goals: context.goals,
      interests: context.interests,
      mutedInterestsToAvoid: context.mutedInterests,
      knowledgeState: context.knowledgeState,
      recentTitlesToAvoidRepeating: context.recentTitles,
      preferredLength: context.preferredLength,
      depth: context.depth,
      novelty: context.novelty,
      allowedCategories: context.allowedCategories,
      requestedCategory: context.requestedCategory,
    },
    edition: context.edition,
    currentDate,
  };
}

function collectWebSourceUrls(output: unknown[]) {
  const urls = new Set<string>();

  for (const item of output) {
    if (!item || typeof item !== "object" || !("type" in item)) continue;
    if (item.type !== "web_search_call" || !("action" in item)) continue;

    const action = item.action;
    if (!action || typeof action !== "object" || !("type" in action)) continue;

    if (action.type === "search" && "sources" in action && Array.isArray(action.sources)) {
      for (const source of action.sources) {
        if (
          source &&
          typeof source === "object" &&
          "url" in source &&
          typeof source.url === "string"
        ) {
          urls.add(source.url);
        }
      }
    }

    if (
      action.type === "open_page" &&
      "url" in action &&
      typeof action.url === "string"
    ) {
      urls.add(action.url);
    }
  }

  return urls;
}

function assertCitationsAreGrounded(
  article: GeneratedArticle,
  searchedUrls: Set<string>,
) {
  if (!searchedUrls.size) {
    throw new Error("The article response did not include web research sources");
  }

  const sourceKeys = new Set(article.sources.map((source) => source.key));
  const ungrounded = article.sources.filter(
    (source) => !searchedUrls.has(source.url),
  );
  if (ungrounded.length) {
    throw new Error("The article cited a URL that was not returned by web search");
  }

  for (const block of article.body) {
    if (block.type === "heading") continue;
    for (const citation of block.citations) {
      if (!sourceKeys.has(citation.sourceKey)) {
        throw new Error(`Unknown source key: ${citation.sourceKey}`);
      }
    }
  }
}

export async function generateArticle(
  context: ArticleGenerationContext,
): Promise<ArticleGenerationResult> {
  if (!context.allowedCategories.length) {
    throw new Error("Article generation requires at least one visible category");
  }

  const client = getOpenAIClient();
  const model = getArticleModel();

  const response = await client.responses.parse({
    model,
    instructions: editorialInstructions,
    input: JSON.stringify(buildArticleGenerationInput(context)),
    tools: [{ type: "web_search_preview", search_context_size: "medium" }],
    include: ["web_search_call.action.sources"],
    text: {
      // OpenAI's strict converter accepts the base object schema, while
      // cross-field uniqueness is enforced immediately after parsing below.
      format: zodTextFormat(generatedArticleFormatSchema, "edison_article"),
      verbosity: "medium",
    },
    reasoning: { effort: "low" },
    max_output_tokens: 12_000,
    max_tool_calls: 12,
    safety_identifier: context.userId,
    store: false,
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no validated article");
  }

  const article = generatedArticleSchema.parse(response.output_parsed);
  if (!context.allowedCategories.includes(article.category)) {
    throw new Error("The generated article used a hidden category");
  }
  if (
    context.requestedCategory &&
    article.category !== context.requestedCategory
  ) {
    throw new Error("The generated article did not use the requested category");
  }
  const searchedUrls = collectWebSourceUrls(response.output);
  assertCitationsAreGrounded(article, searchedUrls);

  return {
    article,
    providerResponseId: response.id,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    webSearchCalls: response.output.filter(
      (item) => item.type === "web_search_call",
    ).length,
  };
}
