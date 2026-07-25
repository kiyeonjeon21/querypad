import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  cardinalityShapeScore,
  confidence,
  isTypeCompatible,
  nameSimilarity,
  singularize,
  splitTokens,
  typeMatchScore,
} from "../src/core/discovery/signals";
import { discoverRelationships, relationshipKey } from "../src/core/discovery/relationships";
import { createNodeDb } from "../src/engine/duckdb/connection";
import { loadFolder } from "../src/engine/duckdb/load";
import { profileTable } from "../src/engine/duckdb/profile";

// ---- Pure signal unit tests ---------------------------------------------------

test("relationshipKey is directional and stable", () => {
  const forward = relationshipKey({
    from: { table: "payments", column: "user_id" },
    to: { table: "users", column: "id" },
    confidence: 100,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  });
  const reversed = relationshipKey({
    from: { table: "users", column: "id" },
    to: { table: "payments", column: "user_id" },
    confidence: 100,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  });
  assert.equal(forward, "payments.user_id->users.id");
  assert.notEqual(forward, reversed);
});

test("splitTokens handles snake_case and camelCase", () => {
  assert.deepEqual(splitTokens("user_id"), ["user", "id"]);
  assert.deepEqual(splitTokens("customerId"), ["customer", "id"]);
});

test("singularize covers common plural forms", () => {
  assert.equal(singularize("users"), "user");
  assert.equal(singularize("companies"), "company");
  assert.equal(singularize("addresses"), "address");
});

test("nameSimilarity rewards canonical FK conventions", () => {
  // events.user_id ↳ users.id
  assert.equal(nameSimilarity("user_id", "id", "users"), 1);
  // payments.customer_id ↳ subscriptions.customer_id
  assert.equal(nameSimilarity("customer_id", "customer_id", "subscriptions"), 1);
});

test("nameSimilarity stays weak for bare surrogate ids", () => {
  // events.id vs payments.id — only the shared "id" token
  assert.ok(nameSimilarity("id", "id", "payments") < 0.6);
  // payments.user_id vs events.id — wrong table reference
  assert.ok(nameSimilarity("user_id", "id", "events") < 0.6);
});

test("type compatibility and match scoring", () => {
  assert.ok(isTypeCompatible("numeric", "numeric"));
  assert.ok(isTypeCompatible("numeric", "text"));
  assert.ok(!isTypeCompatible("numeric", "date"));
  assert.equal(typeMatchScore("BIGINT", "BIGINT", "numeric", "numeric"), 1);
  assert.equal(typeMatchScore("INTEGER", "BIGINT", "numeric", "numeric"), 0.85);
});

test("cardinality shape distinguishes many-to-one from one-to-one", () => {
  assert.equal(cardinalityShapeScore(true, false), 1);
  assert.equal(cardinalityShapeScore(true, true), 0.8);
  assert.equal(cardinalityShapeScore(false, false), 0);
});

test("confidence is 100 for a perfect FK and lower for a weak name", () => {
  assert.equal(
    confidence({ valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 }),
    100
  );
  const weakName = confidence({
    valueOverlap: 1,
    nameSimilarity: 0.33,
    typeMatch: 1,
    cardinalityShape: 1,
  });
  assert.ok(weakName < 90 && weakName > 50);
});

// ---- Engine integration test (real Node DuckDB over fixtures) ------------------

test("inspect fixtures yields exactly the two true relationships", async () => {
  const folder = path.resolve(process.cwd(), "fixtures/data");
  const db = await createNodeDb();
  try {
    const { tables } = await loadFolder(folder, db.runner);
    assert.equal(tables.length, 3);

    const now = 1_700_000_000_000;
    const profiles = [];
    for (const table of tables) {
      profiles.push(await profileTable(table, db.runner, now));
    }

    const relationships = await discoverRelationships(profiles, db.runner);
    const edges = relationships.map(
      (rel) => `${rel.from.table}.${rel.from.column}->${rel.to.table}.${rel.to.column}`
    );

    assert.deepEqual(
      new Set(edges),
      new Set(["payments.user_id->users.id", "events.user_id->users.id"])
    );
    for (const rel of relationships) {
      assert.equal(rel.confidence, 100);
      assert.equal(rel.cardinality, "many-to-one");
    }
    // No spurious edges into surrogate id columns of other tables.
    assert.ok(!edges.some((edge) => edge.endsWith("events.id")));
    assert.ok(!edges.some((edge) => edge.endsWith("payments.id")));
  } finally {
    db.close();
  }
});

// ---- non-id join targets -------------------------------------------------------

test("a price column is not a join target, so its measure survives", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolveSource } = await import("../src/adapters/cli/source");
  const { buildSemanticModel } = await import("../src/core/discovery/semantic-model");

  const dir = await mkdtemp(path.join(tmpdir(), "querypad-fk-target-"));
  // A small price list has unique prices, so it passes the unique + non-null test
  // that used to be the whole definition of a join target.
  await writeFile(
    path.join(dir, "price_list.csv"),
    "id,sku,list_amt\n1,A,10.00\n2,B,20.00\n3,C,30.00\n4,D,40.00\n"
  );
  // line_amt holds those same values by coincidence. It is a measure, not a key.
  await writeFile(
    path.join(dir, "sales.csv"),
    "id,sku,line_amt\n1,A,10.00\n2,B,20.00\n3,A,10.00\n4,C,30.00\n5,D,40.00\n6,B,20.00\n"
  );

  const db = await createNodeDb();
  try {
    const { tables } = await resolveSource({ folder: dir }).load(db.runner);
    const profiles = await Promise.all(tables.map((t) => profileTable(t, db.runner, 1)));
    const rels = await discoverRelationships(profiles, db.runner);
    const keys = rels.map(relationshipKey);

    // The natural key still joins: the foreign column names the target outright.
    assert.ok(keys.includes("sales.sku->price_list.sku"), `expected the sku join, got ${keys}`);
    // The money columns must not be mistaken for one, at any confidence.
    assert.ok(
      !keys.includes("sales.line_amt->price_list.list_amt"),
      `value overlap alone must not make a price a join target, got ${keys}`
    );

    // The damage this prevents: both endpoints of a relationship are dropped from the
    // semantic model, so a phantom edge silently deletes the table's real measure.
    const model = buildSemanticModel(tables.map((t) => t.name), rels, 1, profiles);
    const sale = model.entities.find((e) => e.table === "sales")!;
    const priceList = model.entities.find((e) => e.table === "price_list")!;
    assert.ok(sale.measures.some((m) => m.column === "line_amt"), "sales must keep sum_line_amt");
    assert.ok(
      priceList.measures.some((m) => m.column === "list_amt"),
      "price_list must keep sum_list_amt"
    );
  } finally {
    db.close();
  }
});

test("colliding measure names are table-qualified on every side", async () => {
  const { buildSemanticModel } = await import("../src/core/discovery/semantic-model");
  const { buildTermCatalog } = await import("../src/core/discovery/term-catalog");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolveSource } = await import("../src/adapters/cli/source");

  const dir = await mkdtemp(path.join(tmpdir(), "querypad-dupe-measure-"));
  // Two unrelated tables that both have an `amount` column.
  await writeFile(path.join(dir, "sales.csv"), "id,amount\n1,10.0\n2,20.0\n");
  await writeFile(path.join(dir, "refunds.csv"), "id,amount\n1,5.0\n2,7.0\n");

  const db = await createNodeDb();
  try {
    const { tables } = await resolveSource({ folder: dir }).load(db.runner);
    const profiles = await Promise.all(tables.map((t) => profileTable(t, db.runner, 1)));
    const model = buildSemanticModel(tables.map((t) => t.name), [], 1, profiles);

    const names = model.entities.flatMap((e) => e.measures.map((m) => m.name));
    assert.equal(new Set(names).size, names.length, `measure names must be unique, got ${names}`);
    // Both sides are qualified, so the result never depends on table order.
    assert.ok(names.includes("sales_sum_amount"), names.join(","));
    assert.ok(names.includes("refunds_sum_amount"), names.join(","));
    assert.ok(!names.includes("sum_amount"), "the bare colliding name must not survive");

    // The catalog is keyed by term, so duplicates there were unresolvable by a user.
    const catalog = buildTermCatalog(model);
    const measureTerms = catalog.filter((e) => e.kind === "measure").map((e) => e.term);
    assert.equal(new Set(measureTerms).size, measureTerms.length);
  } finally {
    db.close();
  }
});
