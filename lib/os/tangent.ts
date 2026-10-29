export type TangentSignal = {
  id: string;
  label: string;
  triggeredAt: string;
};

export const TANGENT_OVERLAY_MS = 2_000;
export const TANGENT_COOLDOWN_MS = 6_000;

export type TangentDecision =
  | { type: "coalesce"; id: string }
  | { type: "cooldown" }
  | { type: "create" };

export function tangentDecision(input: {
  now: number;
  activeId: string | null;
  lastTriggeredAt: number | null;
}): TangentDecision {
  if (input.activeId) return { type: "coalesce", id: input.activeId };
  if (input.lastTriggeredAt != null && input.now - input.lastTriggeredAt < TANGENT_COOLDOWN_MS) {
    return { type: "cooldown" };
  }
  return { type: "create" };
}

export function tangentPhase(
  triggeredAt: number,
  now: number,
  skipped: boolean
): "overlay" | "banner" {
  if (skipped) return "banner";
  if (now - triggeredAt < TANGENT_OVERLAY_MS) return "overlay";
  return "banner";
}

export function tangentMotion(reducedMotion: boolean): "static" | "sway" {
  return reducedMotion ? "static" : "sway";
}

export function tangentLabel(rootIssue: string, title: string): string {
  const root = rootIssue.trim();
  return (root || title.trim() || "this issue").slice(0, 180);
}
