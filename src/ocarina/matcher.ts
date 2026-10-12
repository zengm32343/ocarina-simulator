import type { Note } from './notes';

/**
 * Returns the id of the longest song whose notes end `history`, or null.
 * Songs never share a full sequence, so "longest" only matters if a short
 * song is a suffix of a longer one.
 */
export function matchSong(history: readonly Note[], songs: Record<string, readonly Note[]>): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [id, seq] of Object.entries(songs)) {
    if (seq.length <= bestLength || seq.length > history.length) continue;
    const offset = history.length - seq.length;
    if (seq.every((n, i) => history[offset + i] === n)) {
      best = id;
      bestLength = seq.length;
    }
  }
  return best;
}

/**
 * Practice-mode step: given the target song and how many notes are already
 * correct, returns the new progress after `note`. A wrong note restarts,
 * but still counts as the first note if it matches the song's opening.
 */
export function advancePractice(target: readonly Note[], progress: number, note: Note): number {
  if (target[progress] === note) return progress + 1;
  return target[0] === note ? 1 : 0;
}
