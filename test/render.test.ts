import assert from "node:assert/strict";
import test from "node:test";
import { displayWidth, renderTable } from "../src/adapters/cli/render";

const RESULT = {
  columns: ["name", "amount"],
  rows: [
    { name: "Alice", amount: 10 },
    { name: "Bob", amount: 2500 },
    { name: null, amount: null },
  ],
};

test("displayWidth counts CJK as two cells and combining marks as zero", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("한글"), 4);
  assert.equal(displayWidth("데이터셋"), 8);
  assert.equal(displayWidth("日本語"), 6);
  assert.equal(displayWidth("é"), 1); // e + combining acute
});

test("renderTable aligns Korean cells by display width", () => {
  const result = {
    columns: ["도시", "인구"],
    rows: [
      { 도시: "서울", 인구: 9700000 },
      { 도시: "부산광역시", 인구: 3400000 },
    ],
  };
  const lines = renderTable(result).split("\n");
  // No line may exceed the divider's width (all measured in display cells).
  const dividerWidth = displayWidth(lines[1]);
  for (const line of [lines[0], ...lines.slice(2)]) {
    assert.ok(
      displayWidth(line) <= dividerWidth,
      `line wider than divider: "${line}" (${displayWidth(line)} > ${dividerWidth})`
    );
  }
  // 부산광역시 (10 cells) sets the first column's width.
  assert.ok(lines[1].startsWith("-".repeat(10)));
});

test("renderTable right-aligns numeric columns", () => {
  const lines = renderTable(RESULT).split("\n");
  // "amount" width 6; 10 must be right-aligned within it.
  assert.match(lines[2], /Alice\s+10$/);
  assert.match(lines[3], /Bob\s+2500$/);
});

test("renderTable renders NULLs plainly without color", () => {
  const output = renderTable(RESULT);
  assert.match(output, /NULL/);
  assert.ok(!output.includes("\x1b["), "no ANSI codes by default");
});

test("renderTable dims NULLs and bolds the header with color", () => {
  const output = renderTable(RESULT, { color: true });
  assert.ok(output.startsWith("\x1b[1m"), "bold header");
  assert.ok(output.includes("\x1b[2mNULL\x1b[22m"), "dim NULL");
});

test("renderTable clamps to maxWidth by truncating wide columns", () => {
  const result = {
    columns: ["id", "description"],
    rows: [{ id: 1, description: "a very long description that should be truncated" }],
  };
  const output = renderTable(result, { maxWidth: 30 });
  for (const line of output.split("\n")) {
    assert.ok(displayWidth(line) <= 30, `"${line}" exceeds 30 cells`);
  }
  assert.match(output, /…/);
});

test("renderTable caps rows and reports the omission", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
  const output = renderTable({ columns: ["n"], rows }, { rowCap: 2 });
  assert.match(output, /3 more row\(s\) not shown/);
});

test("renderTable numeric-arg back-compat sets the row cap", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
  const output = renderTable({ columns: ["n"], rows }, 2);
  assert.match(output, /3 more row\(s\) not shown/);
});

test("renderTable tsv format emits tab-separated rows without padding", () => {
  const output = renderTable(RESULT, { format: "tsv" });
  const lines = output.split("\n");
  assert.equal(lines[0], "name\tamount");
  assert.equal(lines[1], "Alice\t10");
  assert.equal(lines[3], "NULL\tNULL");
});

test("renderTable handles empty results", () => {
  assert.equal(renderTable({ columns: [], rows: [] }), "(no columns)");
  assert.equal(renderTable({ columns: ["a"], rows: [] }), "(0 rows)");
});
