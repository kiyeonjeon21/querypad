import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseConnectionString,
  redactConnectionString,
} from "../src/engine/attach/connection-string";
import { attachDatabase } from "../src/engine/attach/load";
import { createNodeDb } from "../src/engine/duckdb/connection";
import { runInspect } from "../src/adapters/cli/inspect";
import { resolveSource } from "../src/adapters/cli/source";

// ---- Connection strings -------------------------------------------------------

test("parseConnectionString recognizes postgres URIs and keyword form", () => {
  const uri = parseConnectionString("postgres://alice:secret@db.example.com:5432/shop");
  assert.equal(uri.engine, "postgres");
  assert.equal(uri.target, "postgres://alice:secret@db.example.com:5432/shop");

  assert.equal(parseConnectionString("postgresql://host/db").engine, "postgres");

  const keyword = parseConnectionString("postgres:dbname=shop host=localhost");
  assert.equal(keyword.engine, "postgres");
  assert.equal(keyword.target, "dbname=shop host=localhost");
});

test("parseConnectionString recognizes mysql and sqlite", () => {
  assert.equal(parseConnectionString("mysql://root@127.0.0.1:3306/shop").engine, "mysql");

  const prefixed = parseConnectionString("sqlite:./shop.db");
  assert.equal(prefixed.engine, "sqlite");
  assert.equal(prefixed.target, "./shop.db");

  assert.equal(parseConnectionString("sqlite:///var/db/shop.db").target, "/var/db/shop.db");

  // A bare path with a SQLite-ish extension needs no prefix.
  const bare = parseConnectionString("./data/shop.sqlite3");
  assert.equal(bare.engine, "sqlite");
  assert.equal(bare.target, "./data/shop.sqlite3");
});

test("parseConnectionString rejects unusable values without leaking credentials", () => {
  assert.throws(() => parseConnectionString(""), /Empty --db/);
  assert.throws(() => parseConnectionString("./notes.txt"), /Unrecognized --db/);
  assert.throws(() => parseConnectionString("sqlite:"), /Unrecognized --db|missing a target/);

  try {
    parseConnectionString("redis://alice:hunter2@host/0");
    assert.fail("expected a throw");
  } catch (error) {
    assert.ok(!String((error as Error).message).includes("hunter2"), "password must be redacted");
  }
});

test("redactConnectionString strips URI and keyword credentials", () => {
  assert.equal(
    redactConnectionString("postgres://alice:secret@host:5432/shop"),
    "postgres://host:5432/shop"
  );
  assert.match(redactConnectionString("host=x password=secret dbname=y"), /password=\*\*\*/);
  assert.ok(!redactConnectionString("host=x password=secret dbname=y").includes("secret"));
});

test("a parsed spec's label never carries the password", () => {
  const spec = parseConnectionString("postgres://alice:hunter2@db.internal/shop");
  assert.ok(!spec.label.includes("hunter2"));
  assert.ok(spec.label.includes("db.internal"));
});

// ---- Live attach against SQLite (no server required) --------------------------

/** Build a small two-table SQLite database through DuckDB itself. */
async function makeSqliteFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-attach-"));
  const file = path.join(dir, "shop.db");
  const db = await createNodeDb();
  try {
    await db.runner(`ATTACH '${file}' AS w (TYPE SQLITE)`);
    await db.runner("CREATE TABLE w.users (id INTEGER, email VARCHAR, plan VARCHAR)");
    await db.runner("CREATE TABLE w.orders (id INTEGER, user_id INTEGER, amount DOUBLE)");
    await db.runner(
      "INSERT INTO w.users VALUES (1,'a@x.com','paid'),(2,'b@x.com','free'),(3,'c@x.com','paid')"
    );
    await db.runner("INSERT INTO w.orders VALUES (1,1,10.5),(2,1,20.0),(3,2,5.25),(4,3,99.9)");
    await db.runner("DETACH w");
  } finally {
    db.close();
  }
  return file;
}

test("attachDatabase exposes external tables as views with real row counts", async () => {
  const file = await makeSqliteFixture();
  const db = await createNodeDb();
  try {
    const spec = parseConnectionString(`sqlite:${file}`);
    const { tables } = await attachDatabase(spec, db.runner);

    const names = tables.map((t) => t.name).sort();
    assert.deepEqual(names, ["orders", "users"]);
    assert.equal(tables.find((t) => t.name === "users")!.rowCount, 3);
    assert.equal(tables.find((t) => t.name === "orders")!.rowCount, 4);
    assert.deepEqual(
      tables.find((t) => t.name === "users")!.columns.map((c) => c.name),
      ["id", "email", "plan"]
    );
  } finally {
    db.close();
  }
});

test("the attachment is read-only: writes through it are refused", async () => {
  const file = await makeSqliteFixture();
  const db = await createNodeDb();
  try {
    await attachDatabase(parseConnectionString(`sqlite:${file}`), db.runner);
    await assert.rejects(
      () => db.runner("INSERT INTO __src.main.users VALUES (9,'z@x.com','free')"),
      /read-only/i
    );
  } finally {
    db.close();
  }
});

test("inspect over --db discovers relationships and writes artifacts", async () => {
  const file = await makeSqliteFixture();
  const out = await mkdtemp(path.join(tmpdir(), "querypad-attach-out-"));

  const report = await runInspect(resolveSource({ db: `sqlite:${file}`, out }), 1);

  assert.equal(report.profiles.length, 2);
  assert.equal(report.relationships.length, 1);
  const [rel] = report.relationships;
  assert.equal(`${rel.from.table}.${rel.from.column}`, "orders.user_id");
  assert.equal(`${rel.to.table}.${rel.to.column}`, "users.id");

  const schema = JSON.parse(await readFile(path.join(out, ".datactx", "schema.json"), "utf8"));
  assert.equal(schema.tables.length, 2);
});
