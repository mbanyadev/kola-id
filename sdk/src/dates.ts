// SPDX-License-Identifier: Apache-2.0
/** Day numbers (days since 1970-01-01, UTC) as used by the Kola ID contract. */
export const DAY_SECONDS = 86_400;

export function dayNumber(isoDate: string): bigint {
  const ms = Date.parse(isoDate + 'T00:00:00Z');
  if (Number.isNaN(ms)) throw new Error(`bad date: ${isoDate}`);
  return BigInt(Math.floor(ms / 1000 / DAY_SECONDS));
}

export function dayToIso(day: bigint): string {
  return new Date(Number(day) * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/**
 * Conservative age threshold in days: years*365 + floor(years/4) + 1.
 * Never lets someone pass before their birthday; at most about one day late.
 */
export function minAgeDays(years: number): bigint {
  if (years <= 0) return 0n;
  return BigInt(years * 365 + Math.floor(years / 4) + 1);
}

/** Seconds since epoch at noon UTC of a day number (a safe block time inside that day). */
export function noonOf(day: bigint): number {
  return Number(day) * DAY_SECONDS + DAY_SECONDS / 2;
}
