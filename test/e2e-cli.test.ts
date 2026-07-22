import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("src/adapters/cli/index.ts");

/**
 * Run the CLI as a subprocess exactly as a user would (tsx entry point, piped
 * stdout). cwd stays at the repo root so `--import tsx` resolves; target
 * folders are passed as arguments, mirroring real `querypad inspect <folder>`.
 */
async function cli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", CLI, ...args],
      { env: { ...process.env, NO_COLOR: "1" } }
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", code: failed.code ?? 1 };
  }
}

/** Copy the fixture dataset into a fresh temp dir so artifacts never pollute fixtures/. */
async function freshDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-e2e-"));
  await cp(path.resolve("fixtures/data"), dir, { recursive: true });
  return dir;
}

test("e2e: help exits 0 and lists the commands", async () => {
  const { stdout, code } = await cli(["help"]);
  assert.equal(code, 0);
  for (const command of ["inspect", "ask", "enrich", "explain", "export-okf"]) {
    assert.match(stdout, new RegExp(`querypad ${command}`));
  }
});

test("e2e: unknown command exits non-zero", async () => {
  const { code, stderr } = await cli(["frobnicate"]);
  assert.notEqual(code, 0);
  assert.match(stderr, /Unknown command/);
});

test("e2e: inspect writes .datactx artifacts and prints the summary", async () => {
  const dir = await freshDataDir();
  const { stdout, code } = await cli(["inspect", dir]);
  assert.equal(code, 0);
  assert.match(stdout, /Tables:\s+3/);
  assert.match(stdout, /payments\.user_id ↳ users\.id/);

  for (const artifact of [
    "schema.json",
    "relationships.json",
    "semantic-model.yaml",
    "semantic-model.json",
    "inspect-summary.md",
  ]) {
    const content = await readFile(path.join(dir, ".datactx", artifact), "utf8");
    assert.ok(content.length > 0, `${artifact} is empty`);
  }

  const schema = JSON.parse(await readFile(path.join(dir, ".datactx", "schema.json"), "utf8"));
  assert.equal(schema.tables.length, 3);
});

test("e2e: verdicts.json curates inspect and explain", async () => {
  const dir = await freshDataDir();
  await cli(["inspect", dir]);

  await writeFile(
    path.join(dir, ".datactx", "verdicts.json"),
    JSON.stringify({ verdicts: { "events.user_id->users.id": "rejected" }, overrides: [] })
  );

  const inspect = await cli(["inspect", dir]);
  assert.match(inspect.stdout, /Applied verdicts\.json: 1 rejected/);
  assert.match(inspect.stdout, /Relationships:\s+1\b/);
  assert.ok(!/events\.user_id/.test(inspect.stdout), "rejected edge must not be listed");

  const explain = await cli(["explain", dir]);
  assert.equal(explain.code, 0);
  assert.ok(!/events\.user_id/.test(explain.stdout), "explain must honor the rejection");

  // Curation survives the re-inspect (verdicts.json still present and applied).
  const verdicts = await readFile(path.join(dir, ".datactx", "verdicts.json"), "utf8");
  assert.match(verdicts, /rejected/);
});

test("e2e: explain without artifacts fails with guidance", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-e2e-empty-"));
  const { code, stdout } = await cli(["explain", dir]);
  assert.equal(code, 1);
  assert.match(stdout, /Run `querypad inspect/);
});

test("e2e: export-okf emits an interlinked OKF bundle", async () => {
  const dir = await freshDataDir();
  await cli(["inspect", dir]);
  const { stdout, code } = await cli(["export-okf", dir]);
  assert.equal(code, 0);
  assert.match(stdout, /okf/);

  const index = await readFile(path.join(dir, ".datactx", "okf", "index.md"), "utf8");
  assert.match(index, /users/);
  const users = await readFile(path.join(dir, ".datactx", "okf", "users.md"), "utf8");
  assert.match(users, /type:/);
});
