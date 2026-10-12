import type { Note } from './notes';

/** A hole on a scanned model: rim centre, outward normal and radius, in model units. */
export interface ModelHole {
  p: [number, number, number];
  n: [number, number, number];
  r: number;
}

export interface OcarinaCredit {
  title: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
}

/** A recorded note that loops seamlessly between loopStart and loopEnd (seconds). */
export interface OcarinaSample {
  url: string;
  midi: number;
  loopStart: number;
  loopEnd: number;
}

export interface OcarinaSound {
  /** Octaves above the base pitches (D4 to D5). */
  octave: number;
  /** Recordings; each note re-pitches the nearest one. */
  samples?: OcarinaSample[];
  /** Synth voice used when there are no recordings; vibrato is a fraction of the pitch, rate in Hz. */
  synth?: { harmonics: number[]; breath: number; vibrato: number; rate?: number; brightness: number };
  credits?: OcarinaCredit[];
}

export interface OcarinaStyle {
  id: string;
  /** Procedural styles are drawn in code; model styles load a GLB from the scene's modelBase. */
  kind: 'procedural' | 'model';
  /** Glaze tweaks applied over the scanned material. */
  roughness?: number;
  /**
   * Without fingerings: the hole lit for each note, in the order A, D, R, L, U.
   * With fingerings: the finger holes of a 4-hole ocarina.
   */
  holes?: ModelHole[];
  /** Holes left open for each note (indices into holes); the rest are covered. */
  fingerings?: Record<Note, number[]>;
  credit?: OcarinaCredit;
  sound: OcarinaSound;
}

export const NOTE_ORDER: Note[] = ['A', 'D', 'R', 'L', 'U'];

const CC_BY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const CC0 = { license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const freesound = (title: string, author: string, id: number, license: typeof CC_BY | typeof CC0): OcarinaCredit => ({
  title,
  author,
  authorUrl: `https://freesound.org/people/${author}/`,
  sourceUrl: `https://freesound.org/people/${author}/sounds/${id}/`,
  ...license,
});

/*
 * Recordings were cut to an attack plus a crossfaded loop and level-matched;
 * midi is the measured pitch of the loop.
 */
const SOUND_BASE = `${import.meta.env.BASE_URL}sounds/ocarina/`;
/** FluidR3 GM ocarina, one recording per note at the game's pitches. */
const ITALIAN: OcarinaSound = {
  octave: 0,
  samples: (
    [
      ['d4', 62.02, 0.52, 1.72],
      ['f4', 65.02, 0.52, 1.72],
      ['a4', 69.04, 0.510031, 1.710031],
      ['b4', 71.03, 0.52, 1.72],
      ['d5', 74.04, 0.52, 1.72],
    ] as const
  ).map(([n, midi, loopStart, loopEnd]) => ({ url: `${SOUND_BASE}fluid-${n}.wav`, midi, loopStart, loopEnd })),
  credits: [
    {
      title: 'FluidR3 GM Ocarina',
      author: 'Frank Wen',
      authorUrl: 'https://github.com/gleitz/midi-js-soundfonts',
      sourceUrl: 'https://github.com/gleitz/midi-js-soundfonts',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    },
  ],
};
/** Two real clay ocarinas, played an octave up like the small soprano ocarinas sold in terracotta. */
const TERRACOTTA: OcarinaSound = {
  octave: 1,
  samples: [
    { url: `${SOUND_BASE}terracotta-c5.wav`, midi: 71.99, loopStart: 0.31, loopEnd: 0.91 },
    { url: `${SOUND_BASE}terracotta-as5.wav`, midi: 81.75, loopStart: 0.379969, loopEnd: 0.98 },
  ],
  credits: [freesound('Dry Ocarina in C', 'TheDCHeck', 379378, CC0), freesound('Ocarina High', 'PrimeJunt', 135642, CC_BY)],
};
const XUN: OcarinaSound = {
  octave: 0,
  samples: [
    { url: `${SOUND_BASE}xun-gs4.wav`, midi: 68.15, loopStart: 0.530031, loopEnd: 0.880031 },
    { url: `${SOUND_BASE}xun-c5.wav`, midi: 72.07, loopStart: 0.56, loopEnd: 1.01 },
  ],
  credits: [freesound('Xun Sample', 'franeknflute', 200419, CC_BY)],
};

/**
 * 4-hole fingerings: pitch rises with the total open area, so open the small
 * holes first, then the large ones, and all four for the octave.
 */
const FOUR_HOLE = ([s1, s2]: number[], [l1, l2]: number[]): Record<Note, number[]> => ({
  A: [],
  D: [s1],
  R: [s1, l1],
  L: [s1, l1, l2],
  U: [s1, s2, l1, l2],
});

const hole = (p: ModelHole['p'], n: ModelHole['n'], r: number): ModelHole => ({ p, n, r });

/*
 * Scans were re-oriented (length along x, playing face up, mouthpiece towards +z),
 * scaled to 4.4 units, simplified and compressed from the Sketchfab originals.
 */
export const OCARINA_STYLES: OcarinaStyle[] = [
  { id: 'celadon', kind: 'procedural', sound: ITALIAN },
  {
    id: 'terracotta',
    kind: 'model',
    roughness: 0.85,
    holes: [
      hole([-1.057, 0.419, -1.243], [0.22, 0.96, 0.16], 0.119),
      hole([-0.229, 0.764, -0.263], [0.05, 1, 0.08], 0.116),
      hole([0.409, 0.637, -0.376], [0.34, 0.93, 0.13], 0.081),
      hole([0.987, 0.458, -0.325], [0.27, 0.96, 0.01], 0.103),
      hole([1.569, 0.245, -0.207], [0.33, 0.92, -0.21], 0.078),
    ],
    credit: {
      title: 'Ocarina',
      author: 'fredfroehlich',
      authorUrl: 'https://sketchfab.com/fredfroehlich',
      sourceUrl: 'https://sketchfab.com/models/18674934f040455b8eeba99a999efde2',
      ...CC_BY,
    },
    sound: TERRACOTTA,
  },
  {
    id: 'chile',
    kind: 'model',
    roughness: 0.35,
    holes: [
      hole([-1.119, 0.394, -0.481], [0.11, 0.98, 0.14], 0.057),
      hole([-0.17, 0.386, 0.056], [0.05, 0.99, 0.13], 0.081),
      hole([0.344, 0.399, -0.072], [0.07, 0.94, 0.34], 0.054),
      hole([0.871, 0.347, -0.175], [0.19, 0.96, 0.21], 0.054),
      hole([1.419, 0.249, -0.312], [0.18, 0.98, -0.11], 0.051),
    ],
    credit: {
      title: 'Chilean Ocarina',
      author: 'BRTH Design Works',
      authorUrl: 'https://sketchfab.com/Bearth',
      sourceUrl: 'https://sketchfab.com/models/353572aa9ab44059aeb363e2e0b542b8',
      ...CC_BY,
    },
    // Breathy and bright, like the Andean flutes it is often played with.
    sound: {
      octave: 0,
      synth: { harmonics: [1, 0.35, 0.18, 0.08], breath: 0.1, vibrato: 0.007, rate: 6.2, brightness: 4200 },
    },
  },
  {
    id: 'xun',
    kind: 'model',
    roughness: 0.4,
    holes: [
      hole([-0.752, -0.186, 1.724], [-0.42, 0.1, 0.9], 0.15),
      hole([-0.724, 0.52, 1.515], [-0.35, 0.45, 0.82], 0.15),
      hole([-0.641, 1.121, 1.126], [-0.36, 0.63, 0.69], 0.15),
      hole([0.649, 1.142, 1.1], [0.36, 0.64, 0.68], 0.15),
      hole([0.743, 0.52, 1.509], [0.4, 0.42, 0.81], 0.15),
    ],
    credit: {
      title: 'Xun 塤',
      author: 'licheong',
      authorUrl: 'https://sketchfab.com/licheong',
      sourceUrl: 'https://sketchfab.com/models/444d1f35f50740f29faf6e606f0b0e41',
      ...CC_BY,
    },
    sound: XUN,
  },
  {
    id: 'bird',
    kind: 'model',
    roughness: 0.45,
    holes: [
      hole([-0.89, 0.748, -1.103], [-0.36, 0.59, -0.72], 0.113),
      hole([-0.832, 1.147, 0.544], [-0.36, 0.87, 0.33], 0.122),
      hole([-0.103, 1.26, 0.461], [0.08, 0.98, 0.18], 0.148),
      hole([0.534, 0.967, 0.373], [0.45, 0.87, 0.23], 0.15),
    ],
    fingerings: FOUR_HOLE([0, 1], [2, 3]),
    credit: {
      title: 'Ocarina',
      author: 'profschiuma',
      authorUrl: 'https://sketchfab.com/profschiuma',
      sourceUrl: 'https://sketchfab.com/models/a793e7e2569f4565bbe057957bd11559',
      ...CC_BY,
    },
    // A high, nearly pure whistle with a quick warble.
    sound: { octave: 1, synth: { harmonics: [1, 0.03], breath: 0.025, vibrato: 0.012, rate: 7.5, brightness: 6000 } },
  },
  {
    id: 'turtle',
    kind: 'model',
    roughness: 0.8,
    holes: [
      hole([-0.793, 0.586, -0.91], [-0.35, 0.66, -0.66], 0.096),
      hole([-0.747, 0.872, 0.417], [-0.26, 0.91, 0.32], 0.075),
      hole([0.291, 0.711, -1.001], [0.25, 0.61, -0.75], 0.095),
      hole([0.418, 0.987, 0.429], [0.1, 0.83, 0.56], 0.077),
    ],
    fingerings: FOUR_HOLE([1, 3], [0, 2]),
    credit: {
      title: 'Ocarina',
      author: 'CMPLab',
      authorUrl: 'https://sketchfab.com/secad',
      sourceUrl: 'https://sketchfab.com/models/d1c99ed190e04bf6beec12eea2d21c38',
      ...CC_BY,
    },
    // Dark, hollow and airy: odd harmonics, lots of breath, a slow and shallow vibrato.
    sound: {
      octave: 0,
      synth: { harmonics: [1, 0.02, 0.2, 0, 0.06], breath: 0.14, vibrato: 0.002, rate: 4, brightness: 1400 },
    },
  },
];

export const DEFAULT_STYLE = 'celadon';
