import assert from "node:assert/strict";
import test from "node:test";
import { eligibleOwners, isFictionalOwnerName, ownerChoice } from "./owners";

const executive = [
  { id: "e1", name: "Riley Chen" },
  { id: "e2", name: "Alex" },
];

const pastoral = [
  { id: "p1", name: "Sam Ortiz" },
  { id: "p2", name: "Jordan" },
];

test("eligible owners are only the people passed in for that team", () => {
  assert.deepEqual(
    eligibleOwners(executive).map((owner) => owner.id),
    ["e1"]
  );
  assert.equal(
    eligibleOwners(pastoral).some((owner) => owner.id === "e1"),
    false
  );
  assert.deepEqual(
    eligibleOwners(pastoral).map((owner) => owner.name),
    ["Sam Ortiz"]
  );
});

test("fictional demo names, blanks, and duplicate ids are not offered", () => {
  assert.deepEqual(
    eligibleOwners([
      { id: "1", name: "Alex" },
      { id: "2", name: " jordan " },
      { id: "3", name: "Morgan" },
      { id: "", name: "Pat" },
      { id: "4", name: "   " },
      { id: "5", name: "Pat Lee" },
      { id: "5", name: "Pat Lee duplicate" },
    ]),
    [{ id: "5", name: "Pat Lee" }]
  );
});

test("an empty roster offers nobody", () => {
  assert.deepEqual(eligibleOwners([]), []);
  assert.equal(ownerChoice("e1", "Riley Chen", []), "");
});

test("a saved owner is kept only when that person is eligible", () => {
  assert.equal(ownerChoice("e1", "", executive), "e1");
  assert.equal(ownerChoice("p1", "Sam Ortiz", executive), "");
  assert.equal(ownerChoice(null, "Riley Chen", executive), "e1");
  assert.equal(ownerChoice(null, "Alex", executive), "");
  assert.equal(ownerChoice("e2", "Alex", executive), "");
});

test("fictional owner names match the demo names only", () => {
  assert.equal(isFictionalOwnerName("Alex"), true);
  assert.equal(isFictionalOwnerName("JORDAN"), true);
  assert.equal(isFictionalOwnerName("Morgan"), true);
  assert.equal(isFictionalOwnerName("Riley Chen"), false);
  assert.equal(isFictionalOwnerName("Alex Rivera"), false);
});
