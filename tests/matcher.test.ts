import { describe, expect, test } from 'vitest';
import { advancePractice, matchSong } from '../src/ocarina/matcher';
import type { Note } from '../src/ocarina/notes';
import { SONGS } from '../src/songs';

const notes = Object.fromEntries(Object.entries(SONGS).map(([id, song]) => [id, song.notes]));

describe('matchSong', () => {
  test('recognises every song when played on its own', () => {
    for (const [id, song] of Object.entries(SONGS)) expect(matchSong(song.notes, notes)).toBe(id);
  });

  test('recognises a song after stray notes', () => {
    expect(matchSong(['A', 'A', ...SONGS['song-of-time'].notes], notes)).toBe('song-of-time');
  });

  test('returns null for an unfinished song', () => {
    expect(matchSong(SONGS['zeldas-lullaby'].notes.slice(0, 5), notes)).toBeNull();
  });

  test('no song is a suffix of another', () => {
    const all = Object.entries(SONGS);
    for (const [a, sa] of all) {
      for (const [b, sb] of all) {
        if (a === b || sa.notes.length > sb.notes.length) continue;
        expect(sb.notes.slice(-sa.notes.length).join('')).not.toBe(sa.notes.join(''));
      }
    }
  });
});

describe('advancePractice', () => {
  const target: Note[] = ['L', 'U', 'R'];

  test('advances on the right note', () => {
    expect(advancePractice(target, 0, 'L')).toBe(1);
    expect(advancePractice(target, 1, 'U')).toBe(2);
  });

  test('restarts on a wrong note, keeping it if it opens the song', () => {
    expect(advancePractice(target, 2, 'A')).toBe(0);
    expect(advancePractice(target, 2, 'L')).toBe(1);
  });
});
