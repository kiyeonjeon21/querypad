import pako from "pako";
import type { SharePayload } from "@/types";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeSharePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const compressed = pako.deflate(new TextEncoder().encode(json));
  return toBase64Url(compressed);
}

export function buildShareUrl(
  query: string,
  tables: { name: string; fileName: string; data: Uint8Array }[]
): { url: string; totalSize: number } {
  const d: Record<string, string> = {};
  let totalSize = 0;
  const t: { name: string; fileName: string }[] = [];

  for (const table of tables) {
    d[table.name] = toBase64Url(table.data);
    totalSize += table.data.length;
    t.push({ name: table.name, fileName: table.fileName });
  }

  const payload: SharePayload = { q: query, d, t };
  const encoded = encodeSharePayload(payload);
  const url = `${window.location.origin}/shared?s=${encoded}`;
  return { url, totalSize };
}
