import type { Note } from './ocarina/notes';

/** The twelve Ocarina of Time songs, in N64 button names (A, C-Down, C-Right, C-Left, C-Up). */
export const SONGS: Record<string, { name: string; notes: Note[] }> = {
  'zeldas-lullaby': { name: "Zelda's Lullaby", notes: ['L', 'U', 'R', 'L', 'U', 'R'] },
  'eponas-song': { name: "Epona's Song", notes: ['U', 'L', 'R', 'U', 'L', 'R'] },
  'sarias-song': { name: "Saria's Song", notes: ['D', 'R', 'L', 'D', 'R', 'L'] },
  'suns-song': { name: "Sun's Song", notes: ['R', 'D', 'U', 'R', 'D', 'U'] },
  'song-of-time': { name: 'Song of Time', notes: ['R', 'A', 'D', 'R', 'A', 'D'] },
  'song-of-storms': { name: 'Song of Storms', notes: ['A', 'D', 'U', 'A', 'D', 'U'] },
  minuet: { name: 'Minuet of Forest', notes: ['A', 'U', 'L', 'R', 'L', 'R'] },
  bolero: { name: 'Bolero of Fire', notes: ['D', 'A', 'D', 'A', 'R', 'D', 'R', 'D'] },
  serenade: { name: 'Serenade of Water', notes: ['A', 'D', 'R', 'R', 'L'] },
  nocturne: { name: 'Nocturne of Shadow', notes: ['L', 'R', 'R', 'A', 'L', 'R', 'D'] },
  requiem: { name: 'Requiem of Spirit', notes: ['A', 'D', 'A', 'R', 'D', 'A'] },
  prelude: { name: 'Prelude of Light', notes: ['U', 'R', 'U', 'R', 'L', 'U'] },
};

/** Where each song is explained, on the guide this simulator was built for. */
export const SONGS_GUIDE_URL = 'https://ootguide.com/songs/ocarina-songs/';
