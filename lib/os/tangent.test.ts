import assert from "node:assert/strict";
import test from "node:test";
import {
  TANGENT_COOLDOWN_MS,
  TANGENT_OVERLAY_MS,
  tangentDecision,
  tangentLabel,
  tangentMotion,
  tangentPhase,
} from "./tangent";

test("repeated clicks coalesce into the active alert, then a six-second cooldown applies", () => {
  const active = tangentDecision({ now: 10_000, activeId: "event-1", lastTriggeredAt: 9_000 });
  assert.deepEqual(active, { type: "coalesce", id: "event-1" });
  const cooling = tangentDecision({
    now: 10_000 + TANGENT_COOLDOWN_MS - 1,
    activeId: null,
    lastTriggeredAt: 10_000,
  });
  assert.equal(cooling.type, "cooldown");
  const next = tangentDecision({
    now: 10_000 + TANGENT_COOLDOWN_MS,
    activeId: null,
    lastTriggeredAt: 10_000,
  });
  assert.equal(next.type, "create");
});

test("overlay lasts about two seconds, and skip jumps to the banner without moving the timestamp", () => {
  const triggeredAt = 5_000;
  assert.equal(tangentPhase(triggeredAt, triggeredAt + 500, false), "overlay");
  assert.equal(tangentPhase(triggeredAt, triggeredAt + TANGENT_OVERLAY_MS, false), "banner");
  assert.equal(tangentPhase(triggeredAt, triggeredAt + 100, true), "banner");
  assert.equal(triggeredAt, 5_000);
});

test("a late joiner after two seconds sees the banner, not a replayed overlay", () => {
  assert.equal(tangentPhase(1_000, 1_000 + TANGENT_OVERLAY_MS + 50, false), "banner");
});

test("reduced motion keeps the siren static, and the label prefers the root issue", () => {
  assert.equal(tangentMotion(true), "static");
  assert.equal(tangentMotion(false), "sway");
  assert.equal(tangentLabel("The real issue", "Original title"), "The real issue");
  assert.equal(tangentLabel("  ", "Original title"), "Original title");
});

test("showing a tangent does not rewrite discussion notes", () => {
  const notes = "Still on the root cause";
  const view = { notes, phase: tangentPhase(0, 100, false) };
  assert.equal(view.notes, notes);
  assert.equal(view.phase, "overlay");
});
