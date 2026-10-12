/**
 * The five ocarina notes, named by their N64 button:
 * A = A Button (D4), D = C-Down (F4), R = C-Right (A4), L = C-Left (B4), U = C-Up (D5).
 */
export type Note = 'A' | 'D' | 'R' | 'L' | 'U';

export const NOTES: Note[] = ['A', 'D', 'R', 'L', 'U'];

export const NOTE_FREQ: Record<Note, number> = {
  A: 293.66,
  D: 349.23,
  R: 440,
  L: 493.88,
  U: 587.33,
};

/** Solfège-neutral pitch names, lowest first. */
export const NOTE_PITCH: Record<Note, string> = { A: 'D', D: 'F', R: 'A', L: 'B', U: 'D' };
