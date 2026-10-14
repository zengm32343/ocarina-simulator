import './style.css';
import { BreathInput } from './ocarina/breath';
import { advancePractice, matchSong } from './ocarina/matcher';
import type { Note } from './ocarina/notes';
import type { OcarinaScene } from './ocarina/scene';
import { DEFAULT_STYLE, OCARINA_STYLES, type OcarinaCredit } from './ocarina/styles';
import { OcarinaSynth } from './ocarina/synth';
import { SONGS, SONGS_GUIDE_URL } from './songs';

const STYLE_TEXT: Record<string, { name: string; blurb: string }> = {
  celadon: {
    name: 'Italian 10-hole',
    blurb:
      'The ocarina as most people know it was developed around 1853 by Giuseppe Donati in Budrio, Italy; the name means "little goose". This celadon-glazed version has eight finger holes on top and two thumb holes underneath.',
  },
  terracotta: {
    name: 'Terracotta',
    blurb:
      'Plain fired clay, still the most common ocarina material. Like the one in the game, you hold it sideways and blow into the mouthpiece. The more holes you uncover, the higher the note.',
  },
  chile: {
    name: 'Black clay',
    blurb:
      'A black clay ocarina from Chile, decorated with a white geometric band. Black pottery with white designs is a craft tradition in parts of Chile, such as Quinchamalí. Under the decoration it is a classic sideways-held ocarina with a full row of finger holes.',
  },
  xun: {
    name: 'Xun (China)',
    blurb:
      "One of China's oldest instruments: clay xun about 7,000 years old have been found at Hemudu culture sites. It has no whistle mouthpiece; you blow across the hole on top, like blowing across a bottle.",
  },
  bird: {
    name: 'Bird',
    blurb:
      'Clay whistles and ocarinas shaped like birds and animals were made by many peoples, including in pre-Columbian Mesoamerica. This one is blown through the tail and has just four finger holes: each note is a combination of covered holes (gold dots) and open ones (glowing rings).',
  },
  turtle: {
    name: 'Ancient turtle',
    blurb:
      'A replica of a pre-Columbian turtle-shaped ceramic ocarina from Colombia, 16 cm long, scanned by photogrammetry. Like many ancient ocarinas it has only four finger holes on its shell: each note is a combination of covered holes (gold dots) and open ones (glowing rings).',
  },
};

const STRINGS = {
  recognized: 'You played {song}!',
  practiceDone: 'Perfect! That was {song}.',
  learnMore: 'Where to learn it',
  noWebgl: 'The 3D view is not available on this device. The buttons below still play every note.',
  breathDenied:
    'Microphone access was blocked. Allow it for this page (the icon in the address bar) and reload. On a Mac, also check System Settings › Privacy & Security › Microphone.',
  breathNoMic: 'No microphone was found. Plug one in or check your sound settings.',
  breathBusy: 'The microphone is being used by another app. Close it and try again.',
  breathDeniedMobile:
    'Microphone access was blocked. On a phone, open Settings, find your browser app and turn on Microphone, then reload the page. In Safari, also check aA › Website Settings › Microphone.',
  breathUnsupported: "This browser can't use the microphone. Open the page in Safari or Chrome to use blow mode.",
};

const STYLE_KEY = 'ocarina-style';
const KEY_LABELS: Record<Note, string> = { A: 'Space', D: '↓', R: '→', L: '←', U: '↑' };
const ARROWS: Record<string, Note> = { ArrowLeft: 'L', ArrowUp: 'U', ArrowRight: 'R', ArrowDown: 'D' };
type Shift = 'flat' | 'sharp';
const KEY_SHIFT: Record<string, Shift> = { KeyZ: 'flat', ShiftLeft: 'sharp', ShiftRight: 'sharp' };

const NOTE_MIDI: Record<Note, number> = { A: 62, D: 65, R: 69, L: 71, U: 74 };
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pitchName = (midi: number) => NAMES[midi % 12];

const songNotes = Object.fromEntries(Object.entries(SONGS).map(([id, song]) => [id, song.notes]));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Fills "{title} by {author} ({license})" with links. */
function creditLine(credit: OcarinaCredit): (Node | string)[] {
  const link = (href: string, text: string) => el('a', { href, textContent: text, target: '_blank', rel: 'noopener' });
  return [link(credit.sourceUrl, credit.title), ' by ', link(credit.authorUrl, credit.author), ' (', link(credit.licenseUrl, credit.license), ')'];
}

function setup(root: HTMLElement) {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const stage = $('[data-stage]');
  const toast = $('[data-toast]');
  const strip = $('[data-strip]');
  const targetRow = $('[data-target-row]');
  const targetEl = $('[data-target]');
  const select = $<HTMLSelectElement>('[data-practice]');
  const loading = $('[data-loading]');
  const stylesEl = $('[data-styles]');
  const styleInfo = $('[data-style-info]');
  const keyEls = [...root.querySelectorAll<HTMLElement>('[data-note]')];
  const pitchEls = [...root.querySelectorAll<HTMLElement>('[data-pitch]')];

  for (const [id, song] of Object.entries(SONGS)) select.append(el('option', { value: id, textContent: song.name }));

  const synth = new OcarinaSynth();
  // Touch browsers only allow audio to start on touchend/pointerup, not on pointerdown,
  // so unlock on any tap on the page before the first note.
  for (const type of ['pointerup', 'touchend'] as const) document.addEventListener(type, () => synth.unlock());
  let scene: OcarinaScene | null = null;
  let held: Note[] = [];
  let history: Note[] = [];
  let practice = '';
  let progress = 0;
  let visible = false;
  let toastTimer = 0;

  const pill = (n: Note, extra = '') =>
    el('kbd', { className: ['note', n === 'A' ? 'is-a' : 'is-c', extra].join(' ').trim(), textContent: KEY_LABELS[n] });

  const render = () => {
    strip.replaceChildren(...history.slice(-8).map((n) => pill(n)));
    targetRow.classList.toggle('hidden', !practice);
    if (practice) {
      targetEl.replaceChildren(
        ...SONGS[practice].notes.map((n, i) => pill(n, i < progress ? 'is-done' : i === progress ? 'is-next' : '')),
      );
    }
  };

  const showToast = (template: string, id: string) => {
    const [before, after] = template.split('{song}');
    const link = el('a', { href: SONGS_GUIDE_URL, textContent: STRINGS.learnMore });
    toast.replaceChildren(before, SONGS[id].name, after, link);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 4500);
  };

  const succeed = (id: string, template: string) => {
    synth.chime();
    showToast(template, id);
    window.setTimeout(() => {
      history = [];
      progress = 0;
      render();
    }, 900);
  };

  const register = (note: Note) => {
    history = [...history, note].slice(-16);
    if (practice) {
      const target = SONGS[practice].notes;
      progress = advancePractice(target, progress, note);
      if (progress === target.length) succeed(practice, STRINGS.practiceDone);
    } else {
      const id = matchSong(history, songNotes);
      if (id) succeed(id, STRINGS.recognized);
    }
    render();
  };

  let breath: BreathInput | null = null;
  let blowing = false;
  let fingered: Note | undefined;
  const sound = (note: Note | undefined) => {
    for (const key of keyEls) key.toggleAttribute('data-active', key.dataset.note === note);
    scene?.setActive(note ?? null);
    fingered = note;
    if (note && (!breath || blowing)) synth.noteOn(note);
    else synth.noteOff();
  };

  const press = (note: Note) => {
    held = [...held.filter((n) => n !== note), note];
    sound(note);
    register(note);
  };

  const release = (note: Note) => {
    if (!held.includes(note)) return;
    held = held.filter((n) => n !== note);
    sound(held.at(-1));
  };

  // Shift and Z shift while held; the on-screen keys latch, so a mouse can use them.
  const shiftHeld = new Map<string, Shift>();
  let latched: Shift | null = null;
  const shiftButtons = root.querySelectorAll<HTMLElement>('[data-shift]');
  const updateShift = () => {
    const on = new Set(shiftHeld.values());
    if (latched) on.add(latched);
    shiftButtons.forEach((button) => {
      const shift = button.dataset.shift as Shift;
      button.setAttribute('aria-pressed', String(latched === shift));
      button.toggleAttribute('data-active', on.has(shift));
    });
    const semitones = (on.has('sharp') ? 1 : 0) - (on.has('flat') ? 1 : 0);
    synth.setShift(semitones);
    for (const p of pitchEls) p.textContent = pitchName(NOTE_MIDI[p.dataset.pitch as Note] + semitones);
  };
  const holdShift = (source: string, shift: Shift | null) => {
    if (shift) shiftHeld.set(source, shift);
    else shiftHeld.delete(source);
    updateShift();
  };
  shiftButtons.forEach((button) => {
    const shift = button.dataset.shift as Shift;
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      latched = latched === shift ? null : shift;
      updateShift();
    });
  });

  // A finger or mouse can slide from note to note.
  const pointerNotes = new Map<number, Note>();
  const noteAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-note]')?.dataset.note as Note | undefined;
  const keysEl = $('[data-keys]');
  keysEl.addEventListener('pointermove', (e) => {
    const from = pointerNotes.get(e.pointerId);
    if (!from) return;
    const to = noteAt(e.clientX, e.clientY);
    if (!to || to === from) return;
    pointerNotes.set(e.pointerId, to);
    press(to);
    release(from);
  });
  const lift = (e: PointerEvent) => {
    const note = pointerNotes.get(e.pointerId);
    if (!note) return;
    pointerNotes.delete(e.pointerId);
    release(note);
  };
  keysEl.addEventListener('pointerup', lift);
  keysEl.addEventListener('pointercancel', lift);

  keyEls.forEach((key) => {
    const note = key.dataset.note as Note;
    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointerNotes.set(e.pointerId, note);
      press(note);
      try {
        key.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }
    });
    key.addEventListener('contextmenu', (e) => e.preventDefault());
    key.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        press(note);
      }
    });
    key.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') release(note);
    });
  });

  const keyNote = (e: KeyboardEvent): Note | undefined => {
    if (ARROWS[e.key]) return ARROWS[e.key];
    return e.code === 'Space' ? 'A' : undefined;
  };
  const typing = (e: KeyboardEvent) =>
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    (e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]')) ||
    // Space still presses a focused button or link.
    (e.code === 'Space' && e.target instanceof Element && !!e.target.closest('button, a, [role="radio"]'));
  // A mouse click must not leave focus on a button, or the next Space would press it again.
  root.addEventListener('click', (e) => {
    if (e.detail > 0 && e.target instanceof Element) e.target.closest<HTMLElement>('button')?.blur();
  });
  const keyHeld = new Map<string, Note>();
  window.addEventListener('keydown', (e) => {
    if (!visible || typing(e)) return;
    const shift = KEY_SHIFT[e.code];
    if (shift) {
      e.preventDefault();
      if (!e.repeat) holdShift(e.code, shift);
      return;
    }
    const note = keyNote(e);
    if (!note) return;
    e.preventDefault();
    if (e.repeat || keyHeld.has(e.code)) return;
    keyHeld.set(e.code, note);
    press(note);
  });
  window.addEventListener('keyup', (e) => {
    if (KEY_SHIFT[e.code] && shiftHeld.has(e.code)) holdShift(e.code, null);
    const note = keyHeld.get(e.code);
    if (!note) return;
    keyHeld.delete(e.code);
    release(note);
  });

  const breathButton = $('[data-breath]');
  const breathMeter = $('[data-breath-meter]');
  const breathLevel = $('[data-breath-level]');
  const breathHint = $('[data-breath-hint]');
  const breathError = $('[data-breath-error]');
  const showBreath = (on: boolean) => {
    breathButton.setAttribute('aria-pressed', String(on));
    breathMeter.classList.toggle('hidden', !on);
    breathHint.classList.toggle('hidden', !on);
  };
  const onBreath = (level: number) => {
    breathLevel.style.width = `${Math.round(level * 100)}%`;
    synth.setBreath(level);
    const on = level > 0;
    if (on === blowing) return;
    blowing = on;
    sound(fingered);
  };
  const stopBreath = () => {
    if (!breath) return;
    breath.stop();
    breath = null;
    blowing = false;
    synth.setBreath(null);
    showBreath(false);
    sound(held.at(-1));
  };
  let starting = false;
  breathButton.addEventListener('click', async () => {
    if (breath) return stopBreath();
    if (starting) return;
    starting = true;
    synth.unlock();
    breathError.classList.add('hidden');
    try {
      breath = await BreathInput.start(onBreath);
      showBreath(true);
      sound(held.at(-1));
    } catch (error) {
      const reason = (error as DOMException)?.name || 'Error';
      // In-app browsers (WeChat, Instagram, ...) often cannot reach the microphone at all.
      const inApp = /MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);
      const message =
        reason === 'NotSupportedError' || (inApp && reason === 'NotAllowedError')
          ? STRINGS.breathUnsupported
          : reason === 'NotFoundError' || reason === 'OverconstrainedError'
            ? STRINGS.breathNoMic
            : reason === 'NotReadableError' || reason === 'AbortError'
              ? STRINGS.breathBusy
              : matchMedia('(pointer: coarse)').matches
                ? STRINGS.breathDeniedMobile
                : STRINGS.breathDenied;
      breathError.textContent = `${message} (${reason})`;
      breathError.classList.remove('hidden');
    } finally {
      starting = false;
    }
  });

  const releaseAll = () => {
    keyHeld.clear();
    shiftHeld.clear();
    updateShift();
    held = [];
    sound(undefined);
  };
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    releaseAll();
    stopBreath();
  });

  // Arrow keys and Space play notes, so focus must not stay on the menu after choosing.
  select.addEventListener('change', () => {
    select.blur();
    practice = select.value;
    progress = 0;
    history = [];
    render();
  });
  // ?song=<id> opens straight into practice mode for that song.
  const linkedSong = new URLSearchParams(location.search).get('song');
  if (linkedSong && linkedSong in SONGS) {
    select.value = linkedSong;
    practice = linkedSong;
    render();
  }
  $('[data-clear]').addEventListener('click', () => {
    history = [];
    progress = 0;
    render();
  });

  const savedStyle = (() => {
    try {
      return localStorage.getItem(STYLE_KEY);
    } catch {
      return null;
    }
  })();
  let styleId = OCARINA_STYLES.some((s) => s.id === savedStyle) ? savedStyle! : DEFAULT_STYLE;
  const styleButtons = OCARINA_STYLES.map((style) =>
    el('button', { type: 'button', textContent: STYLE_TEXT[style.id]?.name ?? style.id }),
  );
  styleButtons.forEach((button, i) => {
    button.setAttribute('role', 'radio');
    button.dataset.style = OCARINA_STYLES[i].id;
  });
  stylesEl.append(...styleButtons);

  const renderStyleInfo = () => {
    const style = OCARINA_STYLES.find((s) => s.id === styleId)!;
    const model = style.credit
      ? ['Model: ', ...creditLine(style.credit), ', adapted']
      : ['Model: procedural, drawn in code'];
    const sound = style.sound.credits
      ? ['Sound: ', ...style.sound.credits.flatMap((c, i) => [...(i ? ['; '] : []), ...creditLine(c)]), ', edited']
      : ['Sound: synthesized in your browser to resemble a clay whistle'];
    styleInfo.replaceChildren(
      el('p', {}, STYLE_TEXT[style.id]?.blurb ?? ''),
      el('p', { className: 'credit' }, ...model),
      el('p', { className: 'credit' }, ...sound),
    );
  };

  const applyStyle = async () => {
    styleButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === styleId)));
    renderStyleInfo();
    const style = OCARINA_STYLES.find((s) => s.id === styleId)!;
    void synth.setSound(style.sound);
    if (!scene) return;
    const id = styleId;
    const slow = window.setTimeout(() => loading.classList.remove('hidden'), 150);
    try {
      await scene.setStyle(style);
    } catch {
      // A failed download leaves the previous ocarina on screen.
    }
    clearTimeout(slow);
    if (id === styleId) loading.classList.add('hidden');
  };
  styleButtons.forEach((b) => {
    b.addEventListener('click', () => {
      styleId = b.dataset.style!;
      try {
        localStorage.setItem(STYLE_KEY, styleId);
      } catch {
        // Storage can be blocked; the choice then lasts for this visit only.
      }
      void applyStyle();
    });
  });

  const loadScene = async () => {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
      stage.classList.add('no-webgl');
      stage.textContent = STRINGS.noWebgl;
      return;
    }
    const { createOcarinaScene } = await import('./ocarina/scene');
    // three.js only parses the comma form of hsl().
    const thread = getComputedStyle(document.documentElement).getPropertyValue('--thread').trim();
    const hsl = thread.match(/^hsl\(([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\)$/);
    scene = createOcarinaScene(stage, {
      glow: hsl ? `hsl(${hsl[1]}, ${hsl[2]}, ${hsl[3]})` : undefined,
      modelBase: `${import.meta.env.BASE_URL}models/ocarina/`,
    });
    await applyStyle();
  };

  let loaded = false;
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    if (visible && !loaded) {
      loaded = true;
      void loadScene();
    }
  }).observe(root);

  render();
  void applyStyle();
}

document.querySelectorAll<HTMLElement>('[data-ocarina]').forEach(setup);
