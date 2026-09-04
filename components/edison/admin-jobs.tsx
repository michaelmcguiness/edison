"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { EdisonLogo } from "@/components/edison/brand";
import { edisonApi } from "@/lib/api-client";

type AdminJobsResponse = {
  window: { hours: number; since: string };
  summary: {
    jobsByStatus: Record<string, number>;
    queuedWithoutWorkflowRunId: number;
    usage: {
      operations: number;
      inputTokens: number;
      outputTokens: number;
      webSearchCalls: number;
      estimatedCostUsd: number;
    };
  };
  jobs: Array<{
    id: string;
    userEmail: string;
    kind: string;
    status: string;
    attemptCount: number;
    failureCode: string | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
};

export function AdminJobs() {
  const [data, setData] = useState<AdminJobsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    edisonApi<AdminJobsResponse>("/admin/jobs?hours=24&limit=100")
      .then((response) => {
        if (active) setData(response);
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Edison could not load job diagnostics.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="admin-page">
      <header>
        <Link href="/" className="brand" aria-label="Edison">
          <EdisonLogo />
        </Link>
        <span className="eyebrow">Private operations</span>
        <h1>Generation jobs</h1>
        <p>Recent Workflow health, failures, and estimated OpenAI usage.</p>
      </header>

      {error && (
        <div className="admin-error"><AlertCircle />{error}</div>
      )}
      {!data && !error && (
        <div className="admin-loading"><LoaderCircle className="spin" />Loading diagnostics…</div>
      )}

      {data && (
        <>
          <section className="admin-metrics">
            {Object.entries(data.summary.jobsByStatus).map(([status, count]) => (
              <div key={status}><span>{status}</span><b>{count}</b></div>
            ))}
            <div>
              <span>24h estimated cost</span>
              <b>${data.summary.usage.estimatedCostUsd.toFixed(2)}</b>
            </div>
            <div>
              <span>Web searches</span>
              <b>{data.summary.usage.webSearchCalls}</b>
            </div>
          </section>

          <section className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th><th>Reader</th><th>Kind</th><th>Status</th>
                  <th>Attempts</th><th>Failure</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{new Date(job.createdAt).toLocaleString()}</td>
                    <td>{job.userEmail}</td>
                    <td>{job.kind}</td>
                    <td><span className={`job-status ${job.status}`}>{job.status}</span></td>
                    <td>{job.attemptCount}</td>
                    <td title={job.error ?? undefined}>{job.failureCode ?? "—"}</td>
                  </tr>
                ))}
                {!data.jobs.length && (
                  <tr><td colSpan={6}>No generation jobs yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
