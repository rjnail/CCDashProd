"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { captureIssue } from "@/lib/os/ids-actions";
import { dismissMeetingTangent, raiseMeetingTangent, readMeetingTangent } from "@/lib/os/tangent-actions";
import { tangentMotion, tangentPhase, type TangentSignal } from "@/lib/os/tangent";
import type { OsTeam } from "@/lib/os/types";

type TangentContextValue = {
  raise: (issueId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const TangentContext = createContext<TangentContextValue | null>(null);

export function useTangent(): TangentContextValue {
  const value = useContext(TangentContext);
  if (!value) {
    return {
      raise: async () => ({ ok: false, error: "Tangent alerts are only available inside the meeting." }),
    };
  }
  return value;
}

export function TangentProvider({
  team,
  canFacilitate,
  children,
}: {
  team: OsTeam;
  canFacilitate: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [signal, setSignal] = useState<TangentSignal | null>(null);
  const [skippedId, setSkippedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failure, setFailure] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const announced = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const result = await readMeetingTangent(team);
      if (stop) return;
      if (!result.ok) return;
      setSignal(result.signal);
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [team]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!signal || announced.current === signal.id) return;
    announced.current = signal.id;
    setAnnouncement("Tangent alert. Let’s bring it back. One conversation. One issue.");
  }, [signal]);

  const phase =
    signal == null ? null : tangentPhase(Date.parse(signal.triggeredAt), now, skippedId === signal.id);

  async function raise(issueId: string) {
    const result = await raiseMeetingTangent({ team, issueId });
    if (!result.ok || !result.signal) {
      const error = result.ok ? "This alert was not shared with the meeting." : result.error;
      setFailure(error);
      return { ok: false as const, error };
    }
    setFailure(null);
    setSignal(result.signal);
    return { ok: true as const };
  }

  async function dismiss(action: "return" | "continue" | "captured") {
    if (!signal) return;
    const eventId = signal.id;
    const result = await dismissMeetingTangent({ team, eventId, action });
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setSignal((current) => (current?.id === eventId ? null : current));
    setFailure(null);
  }

  return (
    <TangentContext.Provider value={{ raise }}>
      <div className="tangent-workspace">
      <div className="tangent-live" aria-live="polite">
        {announcement}
      </div>
      {failure && (
        <div className="notice" role="status">
          {failure}
        </div>
      )}
      {signal && phase === "overlay" && (
        <div className={`tangent-overlay tangent-motion-${tangentMotion(reduced)}`} aria-hidden="true">
          <div className="tangent-overlay-card">
            <div className="tangent-siren">🚨</div>
            <p className="tangent-word">TANGENT ALERT</p>
            <p>Let’s bring it back.</p>
            <p className="mini">One conversation. One issue.</p>
            <button
              type="button"
              className="btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSkippedId(signal.id)}
            >
              Skip animation
            </button>
          </div>
        </div>
      )}
      {signal && phase === "banner" && (
        <div className="tangent-banner">
          <p>Tangent alert — are we still solving ‘{signal.label}’?</p>
          <div className="issue-actions">
            <button type="button" className="btn" onMouseDown={(event) => event.preventDefault()} onClick={() => void dismiss("return")}>
              Return to this issue
            </button>
            <button
              type="button"
              className="btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setCaptureOpen(true);
                setCaptureError(null);
              }}
            >
              Capture as a new issue
            </button>
            {canFacilitate && (
              <button
                type="button"
                className="btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void dismiss("continue")}
              >
                Continue—this is relevant
              </button>
            )}
          </div>
        </div>
      )}
      {captureOpen && (
        <form
          className="card tangent-capture"
          onSubmit={(event) => {
            event.preventDefault();
            const title = captureTitle.trim();
            if (!title) {
              setCaptureError("Enter a title.");
              return;
            }
            setPending(true);
            void captureIssue({ team, title }).then(async (saved) => {
              setPending(false);
              if (!saved.ok) {
                setCaptureError(saved.error);
                return;
              }
              setCaptureTitle("");
              setCaptureOpen(false);
              if (signal) await dismiss("captured");
              router.refresh();
            });
          }}
        >
          <label>
            New issue title
            <input value={captureTitle} maxLength={180} onChange={(event) => setCaptureTitle(event.target.value)} />
          </label>
          {captureError && <p role="status">{captureError}</p>}
          <div className="issue-actions">
            <button className="btn primary" type="submit" disabled={pending}>
              Save to Open list
            </button>
            <button
              type="button"
              className="btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setCaptureOpen(false);
                setCaptureError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {children}
      </div>
    </TangentContext.Provider>
  );
}
