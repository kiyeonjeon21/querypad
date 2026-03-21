export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function sanitizeTableName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const sanitized = base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return sanitized || "table_data";
}

export function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
