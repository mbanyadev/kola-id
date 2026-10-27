// SPDX-License-Identifier: Apache-2.0
/** Small byte helpers. Secrets are random 32-byte values that stay in the owner's private state. */
export function randomBytes32(): Uint8Array {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Deterministic 32-byte id from a label (for app ids). Not a secret. */
export function labelBytes32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  const enc = new TextEncoder().encode(label);
  if (enc.length > 32) throw new Error('label longer than 32 bytes');
  out.set(enc);
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromHex(h: string): Uint8Array {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  if (clean.length % 2) throw new Error('odd hex');
  return Uint8Array.from(clean.match(/../g) ?? [], (x) => parseInt(x, 16));
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** ISO 3166-1 numeric codes used in the demo. */
export const COUNTRY = {
  Cameroon: 120,
  Ghana: 288,
  Kenya: 404,
  Nigeria: 566,
  France: 250,
  Iran: 364,
} as const;
