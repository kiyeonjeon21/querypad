import type { QueryResultRows } from "../../engine/duckdb/connection";

const DEFAULT_ROW_CAP = 50;
/** Columns narrower than this are never truncated further. */
const MIN_COLUMN_WIDTH = 4;
const ELLIPSIS = "…";

export interface RenderTableOptions {
  /** Maximum rows to render (default 50; Infinity for all). */
  rowCap?: number;
  /** Clamp the rendered width (display columns); wide columns are truncated to fit. */
  maxWidth?: number;
  /** Emit ANSI styling (bold header, dim NULLs). Default false — callers opt in. */
  color?: boolean;
  /** "table" (default) or "tsv" — tab-separated, uncapped-width, for piping. */
  format?: "table" | "tsv";
}

/**
 * Rendering options for the current terminal: clamp to the window width and
 * enable color on an interactive stdout (honoring NO_COLOR); emit TSV when
 * stdout is piped so downstream tools get machine-readable rows.
 */
export function terminalRenderOptions(): RenderTableOptions {
  const isTty = Boolean(process.stdout.isTTY);
  if (!isTty) return { format: "tsv", rowCap: Infinity };
  return {
    maxWidth: process.stdout.columns || 120,
    color: !process.env.NO_COLOR,
  };
}

/**
 * Display width of one character (code point), East Asian Width style:
 * CJK/Hangul/full-width/emoji count as 2 terminal cells, combining marks as 0.
 */
function charWidth(codePoint: number): number {
  // Combining marks and zero-width characters.
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0xfe0f
  ) {
    return 0;
  }
  // Wide (East Asian W/F) ranges + emoji presentation.
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals .. CJK punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Hiragana .. CJK compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Full-width forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // Emoji blocks
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK extensions B+
  ) {
    return 2;
  }
  return 1;
}

/** Display width of a string in terminal cells (not code units). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char.codePointAt(0)!);
  return width;
}

/** Truncate to a display width, appending an ellipsis when anything was cut. */
function truncateToWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text;
  let width = 0;
  let out = "";
  for (const char of text) {
    const w = charWidth(char.codePointAt(0)!);
    if (width + w > maxWidth - 1) break;
    out += char;
    width += w;
  }
  return out + ELLIPSIS;
}

/** Pad with spaces to a display width; right-aligns numeric cells. */
function padToWidth(text: string, width: number, alignRight: boolean): string {
  const padding = " ".repeat(Math.max(0, width - displayWidth(text)));
  return alignRight ? padding + text : text + padding;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("valueOf" in value) {
      const unwrapped = (value as { valueOf(): unknown }).valueOf();
      if (unwrapped !== value) return formatCell(unwrapped);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function isNumericValue(value: unknown): boolean {
  return typeof value === "number" || typeof value === "bigint";
}

const BOLD = (s: string) => `\x1b[1m${s}\x1b[22m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;

/**
 * Shrink column widths to fit `maxWidth` (including 2-space gutters) by
 * repeatedly narrowing the widest column, never below MIN_COLUMN_WIDTH.
 */
function fitWidths(widths: number[], maxWidth: number): number[] {
  const gutters = 2 * (widths.length - 1);
  const fitted = [...widths];
  let total = fitted.reduce((a, b) => a + b, 0) + gutters;
  while (total > maxWidth) {
    let widest = 0;
    for (let i = 1; i < fitted.length; i++) if (fitted[i] > fitted[widest]) widest = i;
    if (fitted[widest] <= MIN_COLUMN_WIDTH) break; // nothing left to shrink
    fitted[widest] -= 1;
    total -= 1;
  }
  return fitted;
}

/**
 * Render a query result for the terminal. Defaults are pure and style-free
 * (stable for tests and LLM prompt samples); pass `terminalRenderOptions()`
 * at display call sites for width clamping, color, and pipe-mode TSV.
 */
export function renderTable(
  result: QueryResultRows,
  options: RenderTableOptions | number = {}
): string {
  const opts = typeof options === "number" ? { rowCap: options } : options;
  const rowCap = opts.rowCap ?? DEFAULT_ROW_CAP;
  const { columns, rows } = result;
  if (columns.length === 0) return "(no columns)";

  if (opts.format === "tsv") {
    const lines = [columns.join("\t")];
    for (const row of rows.slice(0, rowCap)) {
      lines.push(columns.map((col) => formatCell(row[col]).replaceAll("\t", " ")).join("\t"));
    }
    return lines.join("\n");
  }

  if (rows.length === 0) return "(0 rows)";
  const shown = rows.slice(0, rowCap);

  const cells = shown.map((row) => columns.map((col) => formatCell(row[col])));
  const numeric = columns.map((col) =>
    shown.every((row) => row[col] === null || row[col] === undefined || isNumericValue(row[col]))
  );

  let widths = columns.map((col, i) =>
    Math.max(displayWidth(col), ...cells.map((row) => displayWidth(row[i])))
  );
  if (opts.maxWidth) widths = fitWidths(widths, opts.maxWidth);

  const renderCell = (text: string, i: number): string => {
    const clipped = truncateToWidth(text, widths[i]);
    const padded = padToWidth(clipped, widths[i], numeric[i]);
    if (opts.color && text === "NULL") return padded.replace("NULL", DIM("NULL"));
    return padded;
  };

  const header = columns
    .map((col, i) => padToWidth(truncateToWidth(col, widths[i]), widths[i], false))
    .join("  ");
  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  const body = cells.map((row) => row.map((cell, i) => renderCell(cell, i)).join("  ").trimEnd());

  const lines = [opts.color ? BOLD(header) : header, divider, ...body];
  const omitted = rows.length - shown.length;
  if (omitted > 0) lines.push(`${ELLIPSIS} ${omitted.toLocaleString()} more row(s) not shown`);
  return lines.join("\n");
}
