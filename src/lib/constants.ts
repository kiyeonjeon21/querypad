export const SAMPLE_TABLE_NAMES = new Set(["employees", "departments"]);

/** Hard limit: files above this size are rejected */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/** Soft warning: files above this size show a performance warning */
export const WARN_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate file size. Returns null if OK, or an error/warning message.
 * `type` is "error" (reject) or "warning" (allow with caution).
 */
export function checkFileSize(file: File): { type: "error" | "warning"; message: string } | null {
  if (file.size > MAX_FILE_SIZE) {
    return {
      type: "error",
      message: `${file.name} (${formatFileSize(file.size)}) exceeds the ${formatFileSize(MAX_FILE_SIZE)} limit. Try a smaller file or filter your data before importing.`,
    };
  }
  if (file.size > WARN_FILE_SIZE) {
    return {
      type: "warning",
      message: `${file.name} (${formatFileSize(file.size)}) is large. Performance may be affected since QueryPad runs entirely in your browser.`,
    };
  }
  return null;
}
