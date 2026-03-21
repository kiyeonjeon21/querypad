import pako from "pako";
import type { SharePayload } from "@/types";

export interface DecodedShare {
  query: string;
  tables: { name: string; fileName: string; data: Uint8Array }[];
}

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

/**
 * Decode a v1 (JSON) share payload into DecodedShare.
 */
function decodeV1(inflated: Uint8Array): DecodedShare {
  const json = new TextDecoder().decode(inflated);
  const payload = JSON.parse(json) as SharePayload;
  const tables = payload.t.map((meta) => {
    const b64 = payload.d[meta.name];
    return {
      name: meta.name,
      fileName: meta.fileName,
      data: b64 ? fromBase64Url(b64) : new Uint8Array(0),
    };
  });
  return { query: payload.q, tables };
}

/**
 * Decode a v2 (binary packed) share payload.
 * Format: [0x02][metaLen:4B LE][metaJSON][binary table data...]
 */
function decodeV2(inflated: Uint8Array): DecodedShare {
  let pos = 1; // skip version byte

  const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
  const metaLen = view.getUint32(pos, true);
  pos += 4;

  const metaJson = new TextDecoder().decode(inflated.slice(pos, pos + metaLen));
  pos += metaLen;

  const meta = JSON.parse(metaJson) as {
    q: string;
    t: { name: string; fileName: string; offset: number; length: number }[];
  };

  const dataStart = pos;
  const tables = meta.t.map((t) => ({
    name: t.name,
    fileName: t.fileName,
    data: inflated.slice(dataStart + t.offset, dataStart + t.offset + t.length),
  }));

  return { query: meta.q, tables };
}

/**
 * Decode a share URL parameter into tables and query.
 * Supports both v1 (legacy JSON) and v2 (binary packed) formats.
 */
export function decodeShare(encoded: string): DecodedShare {
  const compressed = fromBase64Url(encoded);
  const inflated = pako.inflate(new Uint8Array(compressed));

  // v2 starts with version byte 0x02; v1 starts with '{' (0x7B)
  if (inflated[0] === 0x02) {
    return decodeV2(inflated);
  }
  return decodeV1(inflated);
}

// Legacy exports for backward compatibility
export function decodeSharePayload(encoded: string): SharePayload {
  const compressed = fromBase64Url(encoded);
  const copy = new Uint8Array(compressed);
  const json = pako.inflate(copy, { to: "string" });
  return JSON.parse(json) as SharePayload;
}

export function decodeTableData(base64url: string): Uint8Array {
  return fromBase64Url(base64url);
}
