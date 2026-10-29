export const MAX_VOTES_PER_PERSON = 3;

export type VoteVisibility = {
  myIssueIds: string[];
  remaining: number;
  totals: { issueId: string; votes: number }[] | null;
};

export function remainingVotes(selected: readonly string[]): number {
  return Math.max(0, MAX_VOTES_PER_PERSON - new Set(selected).size);
}

export function toggleVote(
  selected: readonly string[],
  issueId: string
): { ok: true; selected: string[] } | { ok: false; error: string } {
  const unique = [...new Set(selected)];
  if (unique.includes(issueId)) {
    return { ok: true, selected: unique.filter((id) => id !== issueId) };
  }
  if (unique.length >= MAX_VOTES_PER_PERSON) {
    return { ok: false, error: "You can select up to three different issues." };
  }
  return { ok: true, selected: [...unique, issueId] };
}

export function normalizeSelection(
  issueIds: readonly string[],
  openIssueIds: readonly string[]
): { ok: true; selected: string[] } | { ok: false; error: string } {
  const open = new Set(openIssueIds);
  const selected: string[] = [];
  for (const issueId of issueIds) {
    if (!open.has(issueId)) {
      return { ok: false, error: "Votes are only for open issues." };
    }
    if (selected.includes(issueId)) continue;
    selected.push(issueId);
  }
  if (selected.length > MAX_VOTES_PER_PERSON) {
    return { ok: false, error: "You can select up to three different issues." };
  }
  return { ok: true, selected };
}

/**
 * Totals and other people's ballots stay out of the result until the round is closed.
 * The returned object never includes voter ids.
 */
export function voteVisibility(input: {
  roundStatus: "none" | "open" | "closed";
  myIssueIds: readonly string[];
  ballots?: readonly { voterId: string; issueId: string }[];
}): VoteVisibility {
  const myIssueIds = [...new Set(input.myIssueIds)].slice(0, MAX_VOTES_PER_PERSON);
  if (input.roundStatus !== "closed") {
    return {
      myIssueIds,
      remaining: remainingVotes(myIssueIds),
      totals: null,
    };
  }
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const ballot of input.ballots ?? []) {
    const key = `${ballot.voterId}:${ballot.issueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(ballot.issueId, (counts.get(ballot.issueId) ?? 0) + 1);
  }
  return {
    myIssueIds,
    remaining: 0,
    totals: [...counts.entries()].map(([issueId, votes]) => ({ issueId, votes })),
  };
}

export function suggestOrder(
  issues: readonly { id: string; sortOrder: number; createdAt: string }[],
  totals: readonly { issueId: string; votes: number }[]
): { order: string[]; tieIssueIds: string[] } {
  const votes = new Map(totals.map((row) => [row.issueId, row.votes]));
  const ranked = [...issues].sort((a, b) => {
    const delta = (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0);
    if (delta !== 0) return delta;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const top = ranked.slice(0, 3);
  const thirdVotes = top[2] ? (votes.get(top[2].id) ?? 0) : null;
  const tieIssueIds =
    thirdVotes == null
      ? []
      : ranked
          .filter((issue, index) => index >= 2 && (votes.get(issue.id) ?? 0) === thirdVotes)
          .map((issue) => issue.id);
  return {
    order: top.map((issue) => issue.id),
    tieIssueIds: tieIssueIds.length > 1 ? tieIssueIds : [],
  };
}

export function listBucket(status: string | null): "open" | "long_term" | "solved" {
  if (status === "long_term") return "long_term";
  if (status === "solved") return "solved";
  return "open";
}

export type IssueNote = {
  id: string;
  text: string;
  createdAt: string;
  authorUserId: string | null;
};

export function storedIssueComments(value: unknown): IssueNote[] {
  if (!Array.isArray(value)) return [];
  const notes: IssueNote[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    notes.push({
      id: typeof row.id === "string" && row.id ? row.id : text,
      text,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
      authorUserId: typeof row.authorUserId === "string" ? row.authorUserId : null,
    });
  }
  return notes;
}

/** Notes already on the issue, then any comment list stored in the same record. */
export function visibleIssueNotes(input: { notes: string; comments?: unknown }): IssueNote[] {
  const comments = storedIssueComments(input.comments);
  if (comments.length) return comments;
  const notes = input.notes.trim();
  if (!notes) return [];
  return [{ id: "notes", text: notes, createdAt: "", authorUserId: null }];
}

export function withIssueNote(input: {
  notes: string;
  comments: unknown;
  added: IssueNote;
}): { comments: IssueNote[]; notes: string } {
  const current = storedIssueComments(input.comments);
  const base = current.length
    ? current
    : input.notes.trim()
      ? [{ id: "notes", text: input.notes.trim(), createdAt: "", authorUserId: null }]
      : [];
  const comments = [...base, input.added];
  return {
    comments,
    notes: comments.map((item) => item.text).join("\n\n").slice(0, 4000),
  };
}

export function formatIssueAge(createdAt: string | null, now: Date): string {
  if (!createdAt) return "—";
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "—";
  const days = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function requireResolution(
  text: string
): { ok: true; resolution: string } | { ok: false; error: string } {
  const resolution = text.trim();
  if (!resolution) {
    return { ok: false, error: "Enter a resolution before marking the issue solved." };
  }
  return { ok: true, resolution };
}

export function linkedTodoDraft(input: {
  title: string;
  ownerUserId: string;
  dueOn: string;
}): { ok: true; title: string; ownerUserId: string; dueOn: string; solvesIssue: false } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Enter a to-do title." };
  if (!input.ownerUserId) return { ok: false, error: "Choose one owner." };
  if (!input.dueOn) return { ok: false, error: "Choose a due date." };
  return {
    ok: true,
    title,
    ownerUserId: input.ownerUserId,
    dueOn: input.dueOn,
    solvesIssue: false,
  };
}

export function applyLinkedTodo<T extends { status: string }>(issue: T): T {
  return { ...issue };
}

export function tangentCaptureResult<T extends { notes: string; stage: string; elapsed: number }>(
  state: T,
  title: string
): { ok: true; state: T; issue: { title: string; status: "open" } } | { ok: false; error: string } {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: "Enter a title." };
  return {
    ok: true,
    state: { ...state },
    issue: { title: trimmed, status: "open" },
  };
}

export function resolutionWrite(existingKeys: readonly string[], key: string): "write" | "replay" {
  return existingKeys.includes(key) ? "replay" : "write";
}

export function nextUnresolved(
  issues: readonly { id: string; status: string | null; topRank: number | null; sortOrder: number }[],
  currentId: string
): string | null {
  const open = issues
    .filter(
      (issue) =>
        issue.id !== currentId && (issue.status === "open" || issue.status === "discussing" || issue.status == null)
    )
    .sort((a, b) => {
      const ar = a.topRank ?? 99;
      const br = b.topRank ?? 99;
      if (ar !== br) return ar - br;
      return a.sortOrder - b.sortOrder;
    });
  return open[0]?.id ?? null;
}

export function moveItem(ids: readonly string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= ids.length || target >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function versionsMatch(current: number, expected: number): boolean {
  return current === expected;
}
