import { normalizeUid } from '../utils/uid';

export interface PendingScan {
  uid: string;
  scannedAt: string;
}

// in-memory only, by design - just "what tag was scanned last", not durable state.
// Whoever reads a physical tag (the ESP32 eventually, a curl call / test script today)
// posts here; the "add figure" screen polls it to know a new, unclaimed tag showed up.
let latest: PendingScan | null = null;

export function recordScan(rawUid: string): void {
  latest = { uid: normalizeUid(rawUid), scannedAt: new Date().toISOString() };
}

export function getLatestScan(): PendingScan | null {
  return latest;
}
