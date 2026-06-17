/**
 * Pure guards applied to AI-generated SQL before execution. No IO — unit-testable.
 */

/** Statement kinds we allow `ask` to execute (read-only). */
const READ_ONLY_LEADERS = ["SELECT", "WITH", "EXPLAIN", "DESCRIBE", "PRAGMA", "SHOW", "TABLE", "FROM"];

/** Strip markdown code fences (```sql … ```) and surrounding whitespace from model output. */
export function stripSqlFences(text: string): string {
  let sql = text.trim();
  if (sql.startsWith("```")) {
    sql = sql.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
  }
  return sql.trim();
}

/** Remove SQL line/block comments so the leading keyword check can't be bypassed. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
}

/**
 * True only when every statement is read-only. Rejects DDL/DML (DROP, DELETE,
 * UPDATE, INSERT, ALTER, CREATE, ATTACH, COPY, …) so a slipped-through statement
 * can't mutate state.
 */
export function isReadOnlyQuery(sql: string): boolean {
  const cleaned = stripComments(stripSqlFences(sql));
  if (!cleaned) return false;

  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length === 0) return false;

  return statements.every((statement) => {
    const leader = statement.split(/[\s(]+/, 1)[0]?.toUpperCase() ?? "";
    return READ_ONLY_LEADERS.includes(leader);
  });
}
