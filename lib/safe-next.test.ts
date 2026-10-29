import assert from "node:assert/strict";
import test from "node:test";
import { safeNextPath } from "./safe-next";

test("keeps authorized deep links", () => {
  assert.equal(safeNextPath("/dashboard?section=overview"), "/dashboard?section=overview");
  assert.equal(safeNextPath("/pulse?team=pastoral"), "/pulse?team=pastoral");
  assert.equal(safeNextPath("/settings/users"), "/settings/users");
  assert.equal(safeNextPath("/monthly-expenses"), "/monthly-expenses");
});

test("rejects external and unknown destinations", () => {
  assert.equal(safeNextPath("https://example.com"), null);
  assert.equal(safeNextPath("//example.com"), null);
  assert.equal(safeNextPath("/login"), null);
  assert.equal(safeNextPath("/chms"), null);
});
