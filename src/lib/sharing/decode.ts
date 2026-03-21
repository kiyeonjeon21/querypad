import pako from "pako";
import type { SharePayload } from "@/types";

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeSharePayload(encoded: string): SharePayload {
  const compressed = fromBase64Url(encoded);
  const copy = new Uint8Array(compressed);
  const json = pako.inflate(copy, { to: "string" });
  return JSON.parse(json) as SharePayload;
}

export function decodeTableData(base64url: string): Uint8Array {
  return fromBase64Url(base64url);
}
