import type { Article, ArticleCard } from "@edison/contracts";

export function makeDemoStories(researchedAt: string): ArticleCard[] {
  return [
  {
    id: "deep-time",
    slug: "deep-time",
    category: "tech-science",
    kicker: "Ideas · Earth systems",
    title: "The climate archive hidden beneath our feet",
    deck: "A new generation of sensors is turning ordinary soil into a record of drought, agriculture, and the quiet chemistry that shapes our future.",
    readingMinutes: 9,
    sourceCount: 0,
    researchedAt,
    reason: "Extends your learning thread on planetary systems",
    summary: [
      "Soil stores chemical traces of climate and land use over decades.",
      "Cheaper sensors now make continuous, field-scale observation possible.",
      "The hard problem is interpreting noisy signals without oversimplifying them.",
    ],
    saved: false,
    completed: false,
  },
  {
    id: "cities-memory",
    slug: "cities-memory",
    category: "arts-culture",
    kicker: "History · Urban life",
    title: "Why cities remember what people forget",
    deck: "Street grids, old storefronts, and transit lines preserve decisions long after their authors disappear.",
    readingMinutes: 7,
    sourceCount: 0,
    researchedAt,
    reason: "Because you saved two stories about public space",
    summary: [
      "Built environments act as durable records of political choices.",
      "Everyday infrastructure often outlasts the institutions that created it.",
      "Reading a city well means noticing both what endured and what was erased.",
    ],
    saved: true,
    completed: false,
  },
  {
    id: "small-models",
    slug: "small-models",
    category: "business",
    kicker: "Technology · Strategy",
    title: "The case for smaller, stranger AI models",
    deck: "The next competitive edge may come from systems that know less in general—and far more about one particular world.",
    readingMinutes: 6,
    sourceCount: 0,
    researchedAt,
    reason: "A counterpoint to your recent foundation-model reading",
    summary: [
      "Specialized models can outperform general systems in narrow settings.",
      "Lower operating costs make local experimentation more practical.",
      "The tradeoff is brittleness when tasks drift beyond the training domain.",
    ],
    saved: false,
    completed: false,
  },
  {
    id: "attention",
    slug: "attention",
    category: "tech-science",
    kicker: "Mind · Learning",
    title: "Attention is not a resource. It is a relationship.",
    deck: "What changes when we stop treating focus like fuel and start treating it like a way of meeting the world?",
    readingMinutes: 8,
    sourceCount: 0,
    researchedAt,
    reason: "Selected for your interest in learning how to learn",
    summary: [
      "The resource metaphor makes distraction feel like personal failure.",
      "Attention changes according to context, meaning, and emotional safety.",
      "Designing better environments can matter more than exerting more willpower.",
    ],
    saved: false,
    completed: false,
  },
  ];
}

export function makeDemoArticle(story: ArticleCard, writtenFor: string): Article {
  return {
    ...story,
    topic: story.title,
    writtenFor,
    shareId: null,
    sources: [],
    body: [
      {
        type: "paragraph",
        text: "Some discoveries change what we know. Others change what we are able to notice. The most interesting work happening now belongs to the second kind: new instruments are making the ordinary world newly legible.",
        citations: [],
      },
      { type: "heading", level: 2, text: "A record hiding in plain sight" },
      {
        type: "paragraph",
        text: "For a long time, researchers treated this landscape as background. Better sensing has revealed a living archive—one written slowly through chemistry, pressure, water, and human intervention.",
        citations: [],
      },
      {
        type: "paragraph",
        text: "The breakthrough is not a single machine. It is a change in resolution. Measurements that once required occasional expeditions can now be gathered continuously.",
        citations: [],
      },
      {
        type: "quote",
        text: "Better tools do not merely provide more answers. They let us ask questions that were previously invisible.",
        attribution: null,
        citations: [],
      },
      { type: "heading", level: 2, text: "The interpretation problem" },
      {
        type: "paragraph",
        text: "More measurement does not guarantee more understanding. Signals overlap, instruments drift, and a neat story can be more tempting than an accurate one.",
        citations: [],
      },
      { type: "heading", level: 2, text: "What to watch next" },
      {
        type: "paragraph",
        text: "The next few years will test whether these tools remain specialized research instruments or become shared civic infrastructure.",
        citations: [],
      },
    ],
  };
}
