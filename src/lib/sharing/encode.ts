import pako from "pako";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * V2 binary share format:
 * [0x02][metaLen:4B uint32 LE][metaJSON bytes][table1 data][table2 data]...
 *
 * metaJSON = { q: string, t: [{ name, fileName, offset, length }] }
 * offset/length are relative to the start of the binary data section (after meta).
 *
 * The entire buffer is pako-compressed then base64url-encoded once.
 */
export function buildShareUrl(
  query: string,
  tables: { name: string; fileName: string; data: Uint8Array }[]
): { url: string; totalSize: number } {
  let totalSize = 0;

  // Calculate offsets for each table's data
  const tableMeta: { name: string; fileName: string; offset: number; length: number }[] = [];
  let offset = 0;
  for (const table of tables) {
    tableMeta.push({
      name: table.name,
      fileName: table.fileName,
      offset,
      length: table.data.length,
    });
    offset += table.data.length;
    totalSize += table.data.length;
  }

  const meta = JSON.stringify({ q: query, t: tableMeta });
  const metaBytes = new TextEncoder().encode(meta);

  // Pack: [version 0x02][metaLen 4B LE][metaBytes][table data...]
  const totalBinarySize = 1 + 4 + metaBytes.length + totalSize;
  const buffer = new Uint8Array(totalBinarySize);
  let pos = 0;

  // Version byte
  buffer[pos++] = 0x02;

  // Meta length (uint32 little-endian)
  const view = new DataView(buffer.buffer);
  view.setUint32(pos, metaBytes.length, true);
  pos += 4;

  // Meta JSON bytes
  buffer.set(metaBytes, pos);
  pos += metaBytes.length;

  // Table data
  for (const table of tables) {
    buffer.set(table.data, pos);
    pos += table.data.length;
  }

  const compressed = pako.deflate(buffer);
  const encoded = toBase64Url(compressed);
  const url = `${window.location.origin}/shared?s=${encoded}`;
  return { url, totalSize };
}
