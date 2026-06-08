// Egregious-fact rotation engine.
//
// Picks one of the N facts in `public/data/_meta/egregious-facts.json`
// based on the number of days since the epoch (1970-01-01), so every
// surface (website, email banner, iOS splash) shows the SAME fact on the
// SAME day. The fact changes every `rotationDays` (default 3).
//
// Idempotent + dependency-free so it runs in Node, in the browser (via
// fetch), or inline in Capacitor.
//
// Usage:
//   import { getCurrentEgregious } from './egregious-rotation.mjs';
//   const fact = getCurrentEgregious({ facts, rotationDays: 3 });

const MS_PER_DAY = 86_400_000;

/**
 * Pick the fact for a given date.
 *
 * Formula: index = floor(daysSinceEpoch / rotationDays) % facts.length
 *
 * @param {object} opts
 * @param {Array}  opts.facts          Ordered list of facts.
 * @param {number} [opts.rotationDays] Days between rotations. Default 3.
 * @param {Date}   [opts.date]         Defaults to "now".
 * @param {string} [opts.epoch]        ISO date string. Default 1970-01-01.
 * @returns {{ fact:object, index:number, slot:number, daysSinceEpoch:number, nextRotationDate:Date }}
 */
export function getCurrentEgregious({
  facts,
  rotationDays = 3,
  date = new Date(),
  epoch = '1970-01-01',
} = {}) {
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error('getCurrentEgregious: `facts` must be a non-empty array');
  }
  if (!Number.isFinite(rotationDays) || rotationDays < 1) {
    throw new Error('getCurrentEgregious: `rotationDays` must be >= 1');
  }
  const epochMs = Date.parse(epoch + 'T00:00:00Z');
  // Use UTC day boundaries so the rotation flips at the same instant worldwide.
  const dayMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceEpoch = Math.floor((dayMs - epochMs) / MS_PER_DAY);
  const slot = Math.floor(daysSinceEpoch / rotationDays);
  const index = ((slot % facts.length) + facts.length) % facts.length;
  const fact = facts[index];

  // When does this fact stop being current?
  const daysIntoSlot = daysSinceEpoch - (slot * rotationDays);
  const daysRemaining = rotationDays - daysIntoSlot;
  const nextRotationDate = new Date(dayMs + daysRemaining * MS_PER_DAY);

  return { fact, index, slot, daysSinceEpoch, nextRotationDate };
}

/**
 * Convenience: load the JSON from disk (Node) and pick today's fact.
 * Browser callers should `fetch('/data/_meta/egregious-facts.json')` instead.
 */
export async function getCurrentEgregiousFromDisk(date = new Date()) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const jsonPath = path.resolve(here, '../../public/data/_meta/egregious-facts.json');
  const raw = JSON.parse(await readFile(jsonPath, 'utf8'));
  return {
    ...getCurrentEgregious({ facts: raw.facts, rotationDays: raw.rotationDays, epoch: raw.epoch, date }),
    all: raw.facts,
    rotationDays: raw.rotationDays,
  };
}
