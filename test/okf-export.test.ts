import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeSemanticModel } from "../src/adapters/cli/artifacts";
import { runExportOkf } from "../src/adapters/cli/export-okf";
import { buildOkfBundle } from "../src/core/discovery/okf-export";
import type { SemanticModel } from "../src/core/types/discovery";

const MODEL: SemanticModel = {
  generatedAt: 1700000000000,
  entities: [
    {
      name: "User",
      table: "users",
      synonyms: ["customer"],
      dimensions: [
        { name: "plan", column: "plan", kind: "categorical", values: ["free", "paid"], description: "Tier" },
      ],
      measures: [{ name: "users_count", agg: "count" }],
      belongsTo: [],
      hasMany: ["Payment"],
      hasOne: [],
    },
    {
      name: "Payment",
      table: "payments",
      synonyms: [],
      dimensions: [],
      measures: [{ name: "sum_amount", agg: "sum", column: "amount" }],
      belongsTo: ["User"],
      hasMany: [],
      hasOne: [],
    },
  ],
};

test("buildOkfBundle emits an index + one file per entity with frontmatter and links", () => {
  const byPath = Object.fromEntries(buildOkfBundle(MODEL).map((f) => [f.path, f.content]));

  assert.ok(byPath["index.md"]);
  assert.match(byPath["index.md"], /type: "Dataset"/);
  assert.match(byPath["index.md"], /\[User\]\(users\.md\)/);

  const users = byPath["users.md"];
  assert.match(users, /type: "Table"/);
  assert.match(users, /title: "User"/);
  assert.match(users, /description: "The User entity \(table users\)\."/);
  assert.match(users, /## Dimensions/);
  assert.match(users, /\| plan \| categorical \| `plan` \| Tier \|/);
  assert.match(users, /## Measures/);
  assert.match(users, /`users_count` — count\(\*\)/);
  assert.match(users, /has_many \[Payment\]\(payments\.md\)/);

  const payments = byPath["payments.md"];
  assert.match(payments, /`sum_amount` — sum\(amount\)/);
  assert.match(payments, /belongs_to \[User\]\(users\.md\)/);
});

test("runExportOkf writes the bundle from the persisted model", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "grain-okf-"));
  await writeSemanticModel(dir, MODEL);

  const code = await runExportOkf(dir);
  assert.equal(code, 0);

  const index = await readFile(path.join(dir, ".querypad", "okf", "index.md"), "utf8");
  assert.match(index, /## Entities/);
  const users = await readFile(path.join(dir, ".querypad", "okf", "users.md"), "utf8");
  assert.match(users, /# User/);
});

test("runExportOkf reports when no model has been written", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "grain-okf-empty-"));
  assert.equal(await runExportOkf(dir), 1);
});
