import assert from "node:assert/strict";
import test from "node:test";
import { relationshipKey } from "../src/core/discovery/relationships";
import { applyVerdicts, type VerdictsDoc } from "../src/core/discovery/verdicts";
import type { Relationship } from "../src/core/types/discovery";

function rel(fromTable: string, fromColumn: string, toTable: string, toColumn: string): Relationship {
  return {
    from: { table: fromTable, column: fromColumn },
    to: { table: toTable, column: toColumn },
    confidence: 90,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  };
}

const PAYMENTS_USERS = rel("payments", "user_id", "users", "id");
const EVENTS_USERS = rel("events", "user_id", "users", "id");

test("applyVerdicts is a no-op without a verdicts doc", () => {
  const { relationships, summary } = applyVerdicts([PAYMENTS_USERS], null);
  assert.deepEqual(relationships, [PAYMENTS_USERS]);
  assert.deepEqual(summary, { rejected: 0, overridden: 0, added: 0 });
});

test("applyVerdicts drops rejected edges", () => {
  const doc: VerdictsDoc = {
    verdicts: { [relationshipKey(PAYMENTS_USERS)]: "rejected" },
    overrides: [],
  };
  const { relationships, summary } = applyVerdicts([PAYMENTS_USERS, EVENTS_USERS], doc);
  assert.deepEqual(relationships, [EVENTS_USERS]);
  assert.equal(summary.rejected, 1);
});

test("applyVerdicts upserts overrides by key", () => {
  const edited = { ...PAYMENTS_USERS, confidence: 100 };
  const manual = rel("orders", "user_id", "users", "id");
  const doc: VerdictsDoc = { verdicts: {}, overrides: [edited, manual] };

  const { relationships, summary } = applyVerdicts([PAYMENTS_USERS], doc);
  assert.equal(relationships.length, 2);
  assert.equal(
    relationships.find((r) => relationshipKey(r) === relationshipKey(PAYMENTS_USERS))!.confidence,
    100
  );
  assert.deepEqual(summary, { rejected: 0, overridden: 1, added: 1 });
});

test("applyVerdicts: a rejected key also removes a matching override", () => {
  const manual = rel("orders", "user_id", "users", "id");
  const doc: VerdictsDoc = {
    verdicts: { [relationshipKey(manual)]: "rejected" },
    overrides: [manual],
  };
  const { relationships } = applyVerdicts([], doc);
  assert.deepEqual(relationships, []);
});

test("applyVerdicts is idempotent on a curated list", () => {
  const edited = { ...PAYMENTS_USERS, confidence: 100 };
  const doc: VerdictsDoc = {
    verdicts: { [relationshipKey(EVENTS_USERS)]: "rejected" },
    overrides: [edited],
  };
  const once = applyVerdicts([PAYMENTS_USERS, EVENTS_USERS], doc).relationships;
  const twice = applyVerdicts(once, doc).relationships;
  assert.deepEqual(twice, once);
});
