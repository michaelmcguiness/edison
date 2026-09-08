import { notFound } from "next/navigation";
import Link from "next/link";
import { isDemoMode } from "@/lib/app-mode";
import { EdisonLogo, EdisonMark } from "@/components/edison/brand";
import { memberApiFetch, requireMemberSession } from "@/lib/member-access";
import {
  publicArticleShareSchema,
  type ArticleSource,
  type PublicArticleShare,
} from "@edison/contracts";

export const dynamic = "force-dynamic";

async function getShare(slug: string, accessToken: string): Promise<PublicArticleShare | null> {
  if (isDemoMode()) return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;

  const response = await memberApiFetch(`shares/${encodeURIComponent(slug)}`, accessToken);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Edison could not open this shared article.");

  const parsed = publicArticleShareSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function SharedArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireMemberSession(`/share/${slug}`);
  const share = await getShare(slug, session.accessToken);
  if (!share) notFound();

  const { article } = share;
  const sourceById = new Map(
    article.sources.map((source) => [source.id, source]),
  );

  return (
    <div className="shared-shell">
      <header className="site-header shared-header">
        <Link className="brand" href="/" aria-label="Edison">
          <EdisonLogo />
        </Link>
        <span className="shared-label">Shared article</span>
      </header>
      <main className="article-reader shared-reader">
        <header className="article-head">
          <span className="kicker">{article.kicker}</span>
          <h1>{article.title}</h1>
          <p>{article.deck}</p>
          <div className="byline">
            <EdisonMark className="small" />
            <span>
              <b>Written by Edison</b>
              <small>
                {article.readingMinutes} min · {article.sourceCount} sources ·{" "}
                <time dateTime={article.researchedAt}>
                  Researched {new Date(article.researchedAt).toLocaleDateString()}
                </time>
              </small>
            </span>
          </div>
        </header>

        <div className="article-body">
          {article.body.map((block, index) => {
            if (block.type === "heading") {
              return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
            }
            if (block.type === "quote") {
              return (
                <blockquote key={`${block.text}-${index}`}>
                  {block.text}
                  {block.attribution && <cite>— {block.attribution}</cite>}
                  <PublicCitations
                    citations={block.citations}
                    sources={sourceById}
                  />
                </blockquote>
              );
            }
            return (
              <p key={`${block.text}-${index}`}>
                {block.text}
                <PublicCitations
                  citations={block.citations}
                  sources={sourceById}
                />
              </p>
            );
          })}
        </div>

        <section className="sources">
          <h2>Sources</h2>
          <ol>
            {article.sources.map((source, index) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  <span>{index + 1}</span>
                  <div>
                    <b>{source.publisher}</b>
                    <small>{source.title}</small>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <footer className="shared-cta">
          <span className="eyebrow">A publication for one</span>
          <h2>Make sense of what matters to you.</h2>
          <Link className="primary" href="/">Open Edison</Link>
        </footer>
      </main>
    </div>
  );
}

function PublicCitations({
  citations,
  sources,
}: {
  citations: Array<{ sourceId: string; label: string }>;
  sources: Map<string, ArticleSource>;
}) {
  if (!citations.length) return null;
  return (
    <sup>
      {citations.map((citation, index) => {
        const source = sources.get(citation.sourceId);
        return source ? (
          <a
            key={`${citation.sourceId}-${citation.label}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            {index ? "," : ""}{citation.label}
          </a>
        ) : null;
      })}
    </sup>
  );
}
