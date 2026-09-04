import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAIClient() {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function getArticleModel() {
  return process.env.OPENAI_ARTICLE_MODEL ?? "gpt-5.6-terra";
}

export function getUtilityModel() {
  return process.env.OPENAI_UTILITY_MODEL ?? "gpt-5.6-luna";
}
