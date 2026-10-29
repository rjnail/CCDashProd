"use client";

import type { OsTeam } from "@/lib/os/types";

export type MeetingDraft = {
  notes: string;
  headlines: string;
  decision: string;
  rating: string;
  step: number;
  elapsed: number;
  running: boolean;
  start: number;
};

export const MEETING_LENGTH_SECONDS = 90 * 60;

const meetingDrafts = new Map<OsTeam, MeetingDraft>();
const listeners = new Set<() => void>();
let pauseOnUnmount: OsTeam | null = null;

export function blankDraft(): MeetingDraft {
  return {
    notes: "",
    headlines: "",
    decision: "",
    rating: "",
    step: 0,
    elapsed: 0,
    running: false,
    start: 0,
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeMeeting(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMeetingDraft(team: OsTeam): MeetingDraft {
  return meetingDrafts.get(team) ?? blankDraft();
}

export function setMeetingDraft(team: OsTeam, draft: MeetingDraft) {
  meetingDrafts.set(team, draft);
  emit();
}

export function pauseMeetingDraft(team: OsTeam) {
  const current = meetingDrafts.get(team);
  if (!current?.running) {
    pauseOnUnmount = null;
    return;
  }
  meetingDrafts.set(team, {
    ...current,
    running: false,
    elapsed: current.elapsed + Math.max(0, Math.floor((Date.now() - current.start) / 1000)),
  });
  pauseOnUnmount = team;
  emit();
}

export function consumePause(team: OsTeam): boolean {
  if (pauseOnUnmount !== team) return false;
  pauseOnUnmount = null;
  return true;
}

export function meetingElapsed(draft: MeetingDraft, now: number): number {
  return draft.elapsed + (draft.running ? Math.max(0, Math.floor((now - draft.start) / 1000)) : 0);
}

export function meetingRemainingSeconds(draft: MeetingDraft, now: number): number {
  return Math.max(0, MEETING_LENGTH_SECONDS - meetingElapsed(draft, now));
}

export function formatClock(totalSeconds: number): string {
  const shown = Math.max(0, totalSeconds);
  return `${String(Math.floor(shown / 60)).padStart(2, "0")}:${String(shown % 60).padStart(2, "0")}`;
}
