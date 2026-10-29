"use client";

import { useState } from "react";
import Link from "next/link";
import { askCommunityOs } from "@/lib/os/actions";
import type { OsAnswer, OsAskContext } from "@/lib/os/types";

const SUGGESTED = [
  "How did attendance change versus the same month last year?",
  "Which ministry areas have the largest staffing gaps?",
  "What changed since our last meeting?",
  "Which commitments are overdue?",
  "How is giving tracking against the matching budget period?",
];

export function AskPanel({
  context,
  variant,
  initialQuestion = "",
}: {
  context: OsAskContext;
  variant: "pulse" | "dashboard";
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState<OsAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    const next = text.trim();
    if (!next || pending) return;
    setQuestion(next);
    setPending(true);
    setError(null);
    try {
      const result =
        context.surface === "pulse"
          ? await askCommunityOs(next, {
              surface: "pulse",
              team: context.teamKey ?? "",
              campus: context.campusSlug,
            })
          : await askCommunityOs(next, {
              surface: "dashboard",
              campusSlug: context.campusSlug,
              campusName: context.campusLabel,
            });
      setAnswer(result);
    } catch {
      setError("The question was not answered. Your text is still here.");
    } finally {
      setPending(false);
    }
  }

  const buttonClass = variant === "pulse" ? "btn primary" : "sfdc-btn sfdc-btn--neutral";
  const plainClass = variant === "pulse" ? "btn" : "sfdc-btn sfdc-btn--neutral";
  const updated = context.latestSourceUpdate
    ? new Date(context.latestSourceUpdate).toLocaleString()
    : "No source timestamp";

  return (
    <section className={variant === "pulse" ? "card" : "sfdc-widget"} style={{ padding: variant === "dashboard" ? 16 : undefined }}>
      {variant === "dashboard" && <div>Ask Community OS</div>}
      <div className={variant === "pulse" ? "spaced" : undefined}>
        <p className={variant === "pulse" ? "mini" : undefined} style={{ marginTop: variant === "pulse" ? 0 : 8 }}>
          {context.teamLabel ? `${context.teamLabel} · ` : ""}
          {context.campusLabel} · {context.periodLabel} · Latest source update: {updated}
        </p>
        {variant === "pulse" && <span className="pill gray">Read-only</span>}
      </div>
      {!context.modelConfigured && (
        <p className={variant === "pulse" ? "mini" : undefined}>
          Answering from connected data rules.
          {context.modelMissing ? ` No language model is configured (${context.modelMissing}).` : ""} A language model did
          not reply.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <div className={variant === "pulse" ? "inline" : undefined} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {SUGGESTED.map((prompt) => (
            <button key={prompt} type="button" className={plainClass} onClick={() => void submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <label>
          {variant === "pulse" ? "Your question" : "Question"}
          <textarea
            value={question}
            maxLength={400}
            placeholder={variant === "pulse" ? "Ask about church performance..." : undefined}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <button className={buttonClass} type="submit" disabled={pending} style={{ marginTop: 12 }}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {answer && (
        <div style={{ marginTop: 16 }}>
          <p>
            <strong>{answer.findings}</strong>
          </p>
          {answer.figures.length > 0 && (
            <ul>
              {answer.figures.map((figure) => (
                <li key={figure}>{figure}</li>
              ))}
            </ul>
          )}
          {!context.modelConfigured && (
            <p className={variant === "pulse" ? "mini" : undefined}>
              Answered from connected data rules. A language model did not reply.
            </p>
          )}
          <p>{answer.limitation}</p>
          {answer.citations.length > 0 && (
            <p className={variant === "pulse" ? "mini" : undefined}>
              {answer.citations.map((citation) =>
                citation.href ? (
                  <Link key={`${citation.label}:${citation.href}`} href={citation.href} style={{ marginRight: 12 }}>
                    {citation.label}
                  </Link>
                ) : (
                  <span key={citation.label} style={{ marginRight: 12 }}>
                    {citation.label}
                  </span>
                )
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
