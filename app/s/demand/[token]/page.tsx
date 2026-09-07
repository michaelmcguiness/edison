import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EdisonLogo, EdisonMark } from "@/components/edison/brand";
import { fetchDemandPublicShare, demandPublicShareMetadata } from "@/lib/demand-public-share";
import type { ArticleSource } from "@edison/contracts";

export const dynamic = "force-dynamic";
const getShare = cache((token: string) => fetchDemandPublicShare(token, {
  apiUrl: process.env.NEXT_PUBLIC_API_URL, production: process.env.NODE_ENV === "production",
}));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const share = await getShare((await params).token);
  return share ? demandPublicShareMetadata(share) : { title: "Article unavailable — Edison", robots: { index: false, follow: false } };
}

export default async function PublicReadingPage({ params }: { params: Promise<{ token: string }> }) {
  const share = await getShare((await params).token);
  if (!share) notFound();
  const { article } = share;
  const sources = new Map(article.sources.map((source) => [source.id, source]));
  return <div className="shared-shell">
    <header className="site-header shared-header">
      <Link className="brand" href="/" aria-label="Explore Edison" prefetch={false}><EdisonLogo /></Link>
      <span className="shared-label">Shared article</span>
    </header>
    <main className="article-reader shared-reader">
      <header className="article-head">
        <h1>{article.title}</h1><p>{article.deck}</p>
        <div className="byline"><EdisonMark className="small" /><span><b>Written by Edison</b>
          <small>{article.readingMinutes} min{article.sourceCount > 0 ? ` · ${article.sourceCount} sources` : ""}
            {article.researchedAt ? <> · <time dateTime={article.researchedAt}>Researched {new Date(article.researchedAt).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}</time></> : null}
          </small></span></div>
      </header>
      {article.correction && <aside aria-label="Article correction"><p>{article.correction.note}</p></aside>}
      <div className="article-body">{article.body.map((block, index) => {
        if (block.type === "heading") return <h2 key={index}>{block.text}</h2>;
        const citations = <Citations citations={block.citations} sources={sources} />;
        if (block.type === "quote") return <blockquote key={index}>{block.text}{block.attribution && <cite>— {block.attribution}</cite>}{citations}</blockquote>;
        return <p key={index}>{block.text}{citations}</p>;
      })}</div>
      {article.sources.length > 0 && <section className="sources"><h2>Sources</h2><ol>{article.sources.map((source, index) =>
        <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer"><span>{index + 1}</span><div><b>{source.publisher}</b><small>{source.title}</small></div></a></li>)}</ol></section>}
      <footer className="shared-cta"><p>A public, read-only copy. The reader’s instructions and conversation are private.</p>
        <Link className="primary" href="/" prefetch={false}>Explore Edison</Link></footer>
    </main>
  </div>;
}

function Citations({ citations, sources }: { citations: { sourceId: string; label: string }[]; sources: Map<string, ArticleSource> }) {
  if (!citations.length) return null;
  return <sup>{citations.map((citation, index) => {
    const source = sources.get(citation.sourceId);
    return source ? <a key={`${citation.sourceId}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${citation.label}: ${source.title}`}>{index ? ", " : ""}{citation.label}</a> : null;
  })}</sup>;
}
