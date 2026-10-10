// Picks where a quiz clip starts, for each game mode.
//
// Every song carries (seconds on its audio upload's timeline):
//   musicStart / musicEnd  the part of the upload that is actually music (no silence/fade)
//   skip                   non-music stretches inside that range (optional)
//   chorus                 [start, end] of each chorus; start is where a chorus clip begins
//   vocals                 [start, end] of each sung line (used by "must contain singing")

export const MODES = {
  chorus: { label: 'Chorus', jp: 'サビから', desc: 'Every clip starts right at a chorus.' },
  random: { label: 'Anywhere', jp: 'ランダム', desc: 'A random clip from anywhere in the song.' },
  nochorus: { label: 'No chorus', jp: 'サビ以外', desc: 'A random clip that never touches a chorus. Hard!' },
};

const CHORUS_MARGIN = 0.4;      // keep "no chorus" clips this far away from any chorus
const VOCAL_SHARE = 0.5;        // "must contain singing": at least this share of the clip is sung

/** intervals minus cuts; both are arrays of [a, b] */
export function subtract(intervals, cuts) {
  let out = intervals.map(([a, b]) => [a, b]);
  for (const [ca, cb] of cuts) {
    const next = [];
    for (const [a, b] of out) {
      if (cb <= a || ca >= b) { next.push([a, b]); continue; }
      if (ca > a) next.push([a, ca]);
      if (cb < b) next.push([cb, b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 1e-6);
}

function overlap(a1, b1, a2, b2) {
  return Math.max(0, Math.min(b1, b2) - Math.max(a1, a2));
}

export function vocalShare(song, start, len) {
  if (!song.vocals || !song.vocals.length) return 1;
  let sung = 0;
  for (const [a, b] of song.vocals) sung += overlap(a, b, start, start + len);
  return Math.min(1, sung / len);
}

/** Playable music ranges of a song (non-music stretches removed). */
export function musicRanges(song, { excludeChorus = false } = {}) {
  let ranges = subtract([[song.musicStart, song.musicEnd]], song.skip || []);
  if (excludeChorus) {
    const cuts = (song.chorus || []).map(([a, b]) => [a - CHORUS_MARGIN, b + CHORUS_MARGIN]);
    ranges = subtract(ranges, cuts);
  }
  return ranges;
}

/** Chorus sections a clip of `len` seconds can start at without leaving the music. */
export function chorusStarts(song, len, which = 'any') {
  const ranges = musicRanges(song);
  const ok = (song.chorus || []).filter(([a]) =>
    ranges.some(([ra, rb]) => a >= ra - 0.01 && a + len <= rb + 0.01));
  return which === 'first' ? ok.slice(0, 1) : ok;
}

/** Windows in which a clip of `len` seconds may START. */
function startWindows(song, len, excludeChorus) {
  return musicRanges(song, { excludeChorus })
    .filter(([a, b]) => b - a >= len)
    .map(([a, b]) => [a, b - len]);
}

export function canPlay(song, mode, len, opts = {}) {
  if (mode === 'chorus') return chorusStarts(song, len, opts.chorusWhich).length > 0;
  return startWindows(song, len, mode === 'nochorus').length > 0;
}

/**
 * Returns {start, end, chorusIndex} or null if this song can't produce a clip
 * (e.g. the clip is longer than any chorus-free stretch).
 * opts: { chorusWhich: 'any'|'first', vocalOnly: bool, rng }
 */
export function pickClip(song, mode, len, opts = {}) {
  const rng = opts.rng || Math.random;
  if (mode === 'chorus') {
    const starts = chorusStarts(song, len, opts.chorusWhich);
    if (!starts.length) return null;
    const i = Math.floor(rng() * starts.length);
    const start = starts[i][0];
    return { start, end: start + len, chorusIndex: song.chorus.indexOf(starts[i]) };
  }

  const windows = startWindows(song, len, mode === 'nochorus');
  if (!windows.length) return null;
  const total = windows.reduce((s, [a, b]) => s + (b - a), 0);
  const draw = () => {
    let x = rng() * total;
    for (const [a, b] of windows) {
      const w = b - a;
      if (x <= w) return a + x;
      x -= w;
    }
    return windows[windows.length - 1][1];
  };

  let best = null;
  const tries = opts.vocalOnly ? 80 : 1;
  for (let i = 0; i < tries; i++) {
    const start = draw();
    const share = vocalShare(song, start, len);
    if (!best || share > best.share) best = { start, share };
    if (!opts.vocalOnly || share >= VOCAL_SHARE) break;
  }
  const start = Math.round(best.start * 100) / 100;
  return { start, end: start + len, chorusIndex: -1 };
}
