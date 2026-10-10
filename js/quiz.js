// Quiz page: settings -> (load clip -> play clip -> answer -> reveal) x N -> results.
// Quiz style: four choices, a thinking timer and a score. Practice style: no choices and no
// score; you listen, then show the answer.
import {
  $, h, store, loadSongs, shuffle, sample, fmtTime, initTheme, confirmDialog, toast,
  ICONS, youtubeUrl, englishTitle, sleep, isIOS,
} from './common.js';
import { MODES, pickClip, canPlay } from './clips.js';
import { ClipPlayer, PlayerError, CancelledError, AutoplayBlockedError } from './player.js';
import { t, lang, setLang, htmlLang, LANGS } from './i18n.js';
import { sourcesFor } from './sources.js';
import { openReport } from './report.js';

const SETTINGS_KEY = 'yq.settings.v1';
const SKIP_AFTER = 5;   // seconds into an ad when YouTube's Skip button appears
const DEFAULTS = {
  style: 'quiz',
  mode: 'chorus',
  count: 10,
  clipLen: 5,
  thinkTime: 10,
  noLimit: false,
  pool: null,          // null = every song; otherwise an array of song ids
  volume: 80,
  allowReplay: false,
  revealPlay: true,
  autoNext: false,
};
const STYLES = ['quiz', 'practice'];
const MODE_ICONS = { chorus: ICONS.chorus, random: ICONS.shuffle, nochorus: ICONS.noChorus };
const STYLE_ICONS = { quiz: ICONS.check, practice: ICONS.eye };
const CLIP_PRESETS = [1, 2, 3, 5, 10];
const THINK_PRESETS = [5, 10, 15, 30];
const RING_LEN = 2 * Math.PI * 45;
const AUTO_NEXT_MS = 5000;

let songs = [];
const saved = store.get(SETTINGS_KEY, {}) || {};
let settings = { ...DEFAULTS };
for (const k of Object.keys(DEFAULTS)) if (saved[k] !== undefined) settings[k] = saved[k];
if (!STYLES.includes(settings.style)) settings.style = DEFAULTS.style;
const players = [];
let quiz = null;        // the running game
let repaintTheme = () => {};
const els = {};

const isPractice = (s = settings) => s.style === 'practice';
const fmtSec = (x) => t('sec', { n: Number.isInteger(x) ? x : x.toFixed(1) });
const modeName = (key) => t(`mode.${key}`);
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/* =====================================================================
   Setup screen
   ===================================================================== */

function saveSettings() {
  store.set(SETTINGS_KEY, settings);
  updateStartHint();
}

function poolSongs() {
  if (!Array.isArray(settings.pool)) return songs.slice();
  const ids = new Set(settings.pool);
  return songs.filter((s) => ids.has(s.id));
}

/** Static text in the page (data-t / data-t-aria attributes), the language picker and titles. */
function applyStatic() {
  document.documentElement.lang = htmlLang();
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.tAria));
    el.title = t(el.dataset.tAria);
  }
  els.lang.value = lang();
  repaintTheme();
}

function pressedCard(grid, key, current, icon, title, desc, onPick) {
  const btn = h('button', {
    type: 'button', class: 'mode-card', 'aria-pressed': String(current === key), dataset: { key },
    onclick: () => {
      for (const b of grid.children) b.setAttribute('aria-pressed', String(b === btn));
      onPick(key);
    },
  },
  h('span', { class: 'mode-icon', html: icon }),
  h('strong', {}, title),
  h('span', {}, desc));
  return btn;
}

function renderStyles() {
  const grid = $('#style-grid');
  grid.setAttribute('aria-label', t('style.title'));
  grid.replaceChildren(...STYLES.map((key) => pressedCard(grid, key, settings.style, STYLE_ICONS[key],
    t(`style.${key}`), t(`style.${key}.desc`), (k) => { settings.style = k; renderSliders(); saveSettings(); })));
}

function renderModes() {
  const grid = els.modeGrid;
  grid.setAttribute('aria-label', t('mode.title'));
  grid.replaceChildren(...Object.keys(MODES).map((key) => pressedCard(grid, key, settings.mode, MODE_ICONS[key],
    modeName(key), t(`mode.${key}.desc`), (k) => { settings.mode = k; saveSettings(); })));
}

function paintRange(input) {
  const min = Number(input.min), max = Number(input.max), v = Number(input.value);
  input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
}

let syncChips = () => {};
const rangeSyncs = [];

function bindRange(input, output, get, set, format) {
  const sync = () => {
    input.value = get();
    output.textContent = format(get());
    paintRange(input);
  };
  if (!input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('input', () => {
      set(Number(input.value));
      output.textContent = format(get());
      paintRange(input);
      syncChips();
      saveSettings();
    });
  }
  sync();
  rangeSyncs.push(sync);
  return sync;
}

function renderSliders() {
  rangeSyncs.length = 0;
  $('#count-label').textContent = t(isPractice() ? 'count.practice' : 'count');
  $('#think-field').hidden = isPractice();
  bindRange($('#count'), $('#count-out'), () => settings.count, (v) => { settings.count = v; }, (v) => `${v}`);
  const syncClip = bindRange($('#clip'), $('#clip-out'), () => settings.clipLen, (v) => { settings.clipLen = v; }, fmtSec);
  const syncThink = bindRange($('#think'), $('#think-out'), () => settings.thinkTime,
    (v) => { settings.thinkTime = v; settings.noLimit = false; },
    (v) => (settings.noLimit ? t('think.none') : fmtSec(v)));
  bindRange($('#volume'), $('#volume-out'), () => settings.volume, (v) => { settings.volume = v; }, (v) => `${v}%`);

  const clipChips = $('#clip-chips');
  const thinkChips = $('#think-chips');
  clipChips.setAttribute('aria-label', t('presets.clip'));
  thinkChips.setAttribute('aria-label', t('presets.think'));
  clipChips.replaceChildren(...CLIP_PRESETS.map((v) =>
    h('button', {
      type: 'button', class: 'chip', dataset: { v },
      onclick: () => { settings.clipLen = v; syncClip(); syncChips(); saveSettings(); },
    }, fmtSec(v))));
  thinkChips.replaceChildren(
    ...THINK_PRESETS.map((v) =>
      h('button', {
        type: 'button', class: 'chip', dataset: { v },
        onclick: () => { settings.thinkTime = v; settings.noLimit = false; syncThink(); syncChips(); saveSettings(); },
      }, fmtSec(v))),
    h('button', {
      type: 'button', class: 'chip', dataset: { v: 'inf' },
      onclick: () => { settings.noLimit = !settings.noLimit; syncThink(); syncChips(); saveSettings(); },
    }, t('think.chip')));

  syncChips = () => {
    for (const c of clipChips.children) c.setAttribute('aria-pressed', String(Number(c.dataset.v) === settings.clipLen));
    for (const c of thinkChips.children) {
      const on = c.dataset.v === 'inf' ? settings.noLimit : !settings.noLimit && Number(c.dataset.v) === settings.thinkTime;
      c.setAttribute('aria-pressed', String(on));
    }
    $('#think-out').textContent = settings.noLimit ? t('think.none') : fmtSec(settings.thinkTime);
  };
  syncChips();
}

function renderSwitches() {
  const defs = ['allowReplay', 'revealPlay', 'autoNext'];
  $('#switches').replaceChildren(...defs.map((key) => {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; saveSettings(); });
    return h('label', { class: 'switch' },
      h('span', { class: 'label' }, h('strong', {}, t(`opt.${key}`)), h('span', {}, t(`opt.${key}.desc`))), input);
  }));
}

function songLine(s) {
  return h('span', { class: 'song-name' },
    h('span', { class: 't', lang: 'ja' }, s.title),
    englishTitle(s) ? h('span', { class: 'r' }, englishTitle(s)) : null);
}

function renderPool() {
  const host = $('#pool');
  const selected = new Set(poolSongs().map((s) => s.id));
  const albums = [];
  for (const s of songs) {
    let a = albums.find((x) => x.name === s.album);
    if (!a) albums.push((a = { name: s.album, songs: [] }));
    a.songs.push(s);
  }
  const setPool = (ids) => {
    settings.pool = ids.size === songs.length ? null : songs.filter((s) => ids.has(s.id)).map((s) => s.id);
    saveSettings();
    renderPool();
  };
  host.replaceChildren(
    h('div', { class: 'row', style: { marginBottom: '6px' } },
      h('button', { type: 'button', class: 'chip', onclick: () => setPool(new Set(songs.map((s) => s.id))) }, t('songs.all')),
      h('button', { type: 'button', class: 'chip', onclick: () => setPool(new Set()) }, t('songs.clear'))),
    ...albums.map((a) => {
      const inAlbum = a.songs.filter((s) => selected.has(s.id)).length;
      const full = inAlbum === a.songs.length;
      const toggleAlbum = () => {
        const ids = new Set(selected);
        for (const s of a.songs) {
          if (full) ids.delete(s.id);
          else ids.add(s.id);
        }
        setPool(ids);
      };
      return h('div', { class: 'pool-album' },
        h('div', { class: 'pool-album-head' },
          h('strong', {}, a.name),
          h('span', { class: 'faint small' }, `${inAlbum}/${a.songs.length}`),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'chip', onclick: toggleAlbum }, full ? t('album.none') : t('album.all'))),
        h('div', { class: 'pool-songs' }, ...a.songs.map((s) =>
          h('button', {
            type: 'button', class: 'pool-song', 'aria-pressed': String(selected.has(s.id)), dataset: { id: s.id },
            onclick: () => {
              const ids = new Set(selected);
              if (ids.has(s.id)) ids.delete(s.id);
              else ids.add(s.id);
              setPool(ids);
            },
          }, h('span', { class: 'tick' }), songLine(s), h('small', { class: 'year' }, `${s.year}`)))));
    }));
  const toggle = $('#pool-toggle');
  toggle.textContent = host.hidden ? t('songs.choose') : t('songs.done');
}

function minSongs() {
  return isPractice() ? 1 : 4;
}

function updateStartHint() {
  const pool = poolSongs();
  const playable = pool.filter((s) => canPlay(s, settings.mode, settings.clipLen));
  const hint = $('#start-hint');
  let ok = true;
  const parts = [];
  if (pool.length < minSongs()) {
    ok = false;
    parts.push(t(isPractice() ? 'hint.min1' : 'hint.min4'));
  } else if (!playable.length) {
    ok = false;
    parts.push(t('hint.noroom', { len: fmtSec(settings.clipLen), mode: modeName(settings.mode) }));
  } else {
    if (playable.length < pool.length) parts.push(t('hint.leftout', { n: pool.length - playable.length, len: fmtSec(settings.clipLen) }));
    if (settings.count > playable.length) parts.push(t('hint.repeat', { songs: playable.length, count: settings.count }));
  }
  if (!parts.length) {
    const count = t(isPractice() ? 'hint.clips' : 'hint.questions', { n: settings.count });
    const time = isPractice() ? t('hint.practice')
      : settings.noLimit ? t('hint.noTime') : t('hint.answerIn', { len: fmtSec(settings.thinkTime) });
    parts.push(t('hint.summary', { count, len: fmtSec(settings.clipLen), time }));
  }
  hint.textContent = parts.join(' ');
  hint.classList.toggle('warn', !ok || playable.length < pool.length);
  $('#start').disabled = !ok;
  $('#start-label').textContent = t(isPractice() ? 'start.practice' : 'start.quiz');
  $('#pool-count').textContent = t('songs.count', { n: pool.length, total: songs.length });
}

function renderSetup() {
  renderStyles();
  renderModes();
  renderSliders();
  renderSwitches();
  renderPool();
  updateStartHint();
}

/* =====================================================================
   Stage cover (the "mystery" panel that hides the video)
   ===================================================================== */

function ring(center, fraction = 0) {
  const wrap = h('div', { class: 'ring' });
  wrap.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx="50" cy="50" r="45" fill="none" stroke-width="6"/>
      <circle class="bar" cx="50" cy="50" r="45" fill="none" stroke-width="6"
        stroke-dasharray="${RING_LEN}" stroke-dashoffset="${RING_LEN * (1 - fraction)}"/>
    </svg>`;
  wrap.append(h('div', { class: 'ring-center' }, center));
  return wrap;
}

function setRing(fraction) {
  const bar = els.coverInner.querySelector('.ring .bar');
  if (bar) bar.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - fraction)));
}

function eqBars() {
  return h('div', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i'));
}

function cover(kind, ...content) {
  els.stage.classList.toggle('ad', kind === 'ad');
  els.stage.classList.toggle('tap', kind === 'tap');
  els.cover.classList.toggle('revealed', kind === 'revealed');
  els.cover.classList.toggle('playing', kind === 'playing');
  if (kind !== 'revealed') els.coverInner.replaceChildren(...content);
}

/* =====================================================================
   Game flow. Every async step captures its `game` and bails out if the
   player quit, restarted or moved on in the meantime.
   ===================================================================== */

const live = (game, i) => quiz === game && !game.over && game.index === i;

function makeQuestion(game, song) {
  const { mode, clipLen } = game.settings;
  const srcs = sourcesFor(song).filter((x) => !game.failed.has(x.videoId));
  const src = srcs.find((x) => canPlay(x.song, mode, clipLen)) || srcs[srcs.length - 1];
  const clip = pickClip(src.song, mode, clipLen);
  const source = game.pool.length >= 4 ? game.pool : songs;
  const distractors = isPractice(game.settings) ? [] : sample(source.filter((s) => s.id !== song.id), 3);
  return { song, srcs, src, clip, options: shuffle([song, ...distractors]), answer: undefined, correct: false, reason: null, timeMs: null };
}

function buildQuestions(game) {
  const out = [];
  let bag = [];
  let last = null;
  for (let i = 0; i < game.settings.count; i++) {
    if (!bag.length) {
      bag = shuffle(game.playable);
      if (last && bag.length > 1 && bag[bag.length - 1].id === last.id) bag.unshift(bag.pop());
    }
    const song = bag.pop();
    out.push(makeQuestion(game, song));
    last = song;
  }
  return out;
}

async function ensurePlayers() {
  // iPhones need a tap on the player itself to play sound; YouTube's own play button takes it there.
  const controls = isIOS();
  if (!players.length) players.push(new ClipPlayer($('#slot-0'), { controls }), new ClipPlayer($('#slot-1'), { controls }));
  await Promise.all(players.map((p) => p.init()));
}

function setActiveSlot(k) {
  $('#slot-0').classList.toggle('active', k === 0);
  $('#slot-1').classList.toggle('active', k === 1);
}

async function startQuiz() {
  const pool = poolSongs();
  const playable = pool.filter((s) => canPlay(s, settings.mode, settings.clipLen));
  if (pool.length < minSongs() || !playable.length) return;
  if (quiz) quiz.over = true;
  resultsPlayOp++;
  const game = {
    settings: { ...settings }, pool, playable,
    index: 0, phase: 'loading', correct: 0, over: false,
    unavailable: new Set(), failed: new Set(), replaced: 0,
  };
  game.questions = buildQuestions(game);
  quiz = game;

  $('#setup').hidden = true;
  $('#play').hidden = false;
  $('#results-panel').hidden = true;
  $('#question-panel').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderPill(game);
  clearPanel();
  renderTop();
  setActiveSlot(0);
  cover('loading', h('div', { class: 'spinner' }), h('div', { class: 'cover-status' }, t('play.starting')));

  try {
    await ensurePlayers();
  } catch (err) {
    if (quiz !== game || game.over) return;
    cover('error',
      h('div', { class: 'cover-status' }, t('play.noPlayer')),
      h('div', { class: 'cover-sub' }, err.message),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn', type: 'button', onclick: startQuiz }, t('play.tryAgain')),
        h('button', { class: 'btn ghost', type: 'button', onclick: backToSetup }, t('play.back'))));
    return;
  }
  if (quiz !== game || game.over) return;
  runQuestion(game, 0);
}

function renderPill(game) {
  els.modePill.textContent = isPractice(game.settings)
    ? `${t('style.practice')} · ${modeName(game.settings.mode)}`
    : modeName(game.settings.mode);
}

function renderTop() {
  const game = quiz;
  if (!game) return;
  const n = game.questions.length;
  const practice = isPractice(game.settings);
  if (game.phase === 'results') {
    els.qcount.replaceChildren(t('play.results'));
  } else {
    const i = Math.min(game.index, n - 1);
    els.qcount.replaceChildren(`${t(practice ? 'play.clip' : 'play.q', { n: i + 1 })} `, h('span', {}, `/ ${n}`));
  }
  els.scorebox.hidden = practice;
  els.scorebox.textContent = `✓ ${game.correct}`;
  els.scorebox.title = t('play.correct', { n: game.correct });
  els.dots.replaceChildren(...game.questions.map((q, k) => {
    const done = q.answer !== undefined;
    const cls = done ? (practice ? 'done' : q.correct ? 'ok' : 'ng') : k === game.index ? 'now' : '';
    return h('i', { class: cls });
  }));
}

function clearPanel() {
  els.options.replaceChildren();
  els.answerBar.replaceChildren();
  els.reveal.hidden = true;
  els.reveal.replaceChildren();
  stopTimer();
}

function replacementSong(game, q) {
  const used = new Set(game.questions.map((x) => x.song.id));
  const ok = (s) => !game.unavailable.has(s.id) && s.id !== q.song.id;
  const fresh = game.playable.filter((s) => ok(s) && !used.has(s.id));
  const list = fresh.length ? fresh : game.playable.filter(ok);
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

function loadingCover(game, i) {
  cover('loading', h('div', { class: 'spinner' }), h('div', { class: 'cover-status' }, t('play.loading')),
    h('div', { class: 'cover-sub' }, t(isPractice(game.settings) ? 'play.ofClips' : 'play.of', { n: i + 1, total: game.questions.length })));
}

/**
 * An ad plays before question i's clip (`time` = seconds into it, null = none). While that question
 * is on screen the ad shows, so it can be skipped, but only from 5 s in: before that YouTube's
 * "skip in …" box shows the video's thumbnail, which could give the song away.
 */
function showAd(game, i, time) {
  const q = game.questions[i];
  if (!q) return;
  q.ad = time;
  if (!live(game, i) || game.phase !== 'loading') return;
  const view = time == null ? 'none' : time >= SKIP_AFTER ? 'skip' : 'wait';
  if (view === game.adView) return;
  game.adView = view;
  if (view === 'none') loadingCover(game, i);
  else if (view === 'wait') {
    cover('loading', h('div', { class: 'spinner' }), h('div', { class: 'cover-status' }, t('play.ad')),
      h('div', { class: 'cover-sub' }, t('play.ad.wait')));
  } else cover('ad', h('div', { class: 'cover-status' }, t('play.ad')), h('div', { class: 'cover-sub' }, t('play.ad.sub')));
}

/**
 * Buffer question i on its player. If the audio upload won't play here (region, removed), the
 * song's MV is used instead (clip picked again on the MV); if that won't play either, another
 * song. An ad before the video is waited for (and shown).
 */
function prepareQuestion(game, i) {
  const q = game.questions[i];
  if (!q) return Promise.resolve();
  if (!q.prep) {
    const player = players[i % 2];
    const run = (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          await player.prepare(q.src.videoId, q.src.toVideo(q.clip.start), { onAd: (time) => showAd(game, i, time) });
          return;
        } catch (err) {
          if (!(err instanceof PlayerError) || game.over) throw err;
          game.failed.add(q.src.videoId);
          const { mode, clipLen } = game.settings;
          const next = q.srcs.find((x) => !game.failed.has(x.videoId) && canPlay(x.song, mode, clipLen));
          if (next) {
            console.warn(`[quiz] ${q.song.title}: the ${q.src.kind === 'mv' ? 'MV' : 'audio track'} won't play here (${err.message}). Using the ${next.kind === 'mv' ? 'MV' : 'audio track'}.`);
            q.src = next;
            q.clip = pickClip(next.song, mode, clipLen);
            continue;
          }
          game.unavailable.add(q.song.id);
          const repl = replacementSong(game, q);
          if (!repl) throw err;
          console.warn(`[quiz] ${q.song.title}: ${err.message} Using ${repl.title} instead.`);
          Object.assign(q, makeQuestion(game, repl));
          game.replaced++;
        }
      }
      throw new Error('Could not load a playable song.');
    })();
    q.prep = run;
    run.catch(() => { if (q.prep === run) q.prep = null; });
  }
  return q.prep;
}

async function runQuestion(game, i) {
  if (quiz !== game || game.over) return;
  game.index = i;
  game.phase = 'loading';
  clearPanel();
  renderTop();
  setActiveSlot(i % 2);
  loadingCover(game, i);
  game.adView = 'none';
  if (game.questions[i].ad != null) showAd(game, i, game.questions[i].ad);
  try {
    await prepareQuestion(game, i);
  } catch (err) {
    if (err instanceof CancelledError || !live(game, i)) return;
    showError(game, i, err, () => runQuestion(game, i));
    return;
  }
  if (!live(game, i)) return;

  // a short beat so a clip never starts by surprise
  if (i === 0) {
    for (const n of ['3', '2', '1']) {
      cover('ready', ring(h('div', { class: 'cover-big' }, n), 0), h('div', { class: 'cover-status' }, t('play.ready')));
      await sleep(650);
      if (!live(game, i)) return;
    }
  } else {
    cover('ready', ring(eqBars(), 0), h('div', { class: 'cover-status' }, t('play.listen')));
    await sleep(450);
    if (!live(game, i)) return;
  }
  playPhase(game, i, false);
}

async function playPhase(game, i, isReplay, userStarted = false) {
  const q = game.questions[i];
  const player = players[i % 2];
  game.phase = isReplay ? 'replaying' : 'playing';
  const listening = () => cover('starting', ring(eqBars(), 0), h('div', { class: 'cover-status' }, t(isReplay ? 'play.replaying' : 'play.listen')),
    h('div', { class: 'cover-sub' }, t('play.clipLen', { len: fmtSec(game.settings.clipLen) })));
  if (!userStarted) listening();
  try {
    await player.playClip(q.src.toVideo(q.clip.start), game.settings.clipLen, {
      volume: game.settings.volume,
      userStarted,
      onProgress: setRing,
      onStart: () => {
        if (!live(game, i)) return;
        if (userStarted) listening();
        els.cover.classList.add('playing');
      },
    });
  } catch (err) {
    if (err instanceof CancelledError || !live(game, i)) return;
    if (err instanceof AutoplayBlockedError && isIOS() && !userStarted) {
      // The cover lets the tap through to the player, which is the only way an iPhone plays sound.
      cover('tap', h('div', { class: 'tap-icon', html: ICONS.play }), h('div', { class: 'cover-status' }, t('play.tap')),
        h('div', { class: 'cover-sub' }, t('play.tap.sub')));
      playPhase(game, i, isReplay, true);
      return;
    }
    if (err instanceof AutoplayBlockedError) {
      cover('blocked',
        h('div', { class: 'cover-status' }, t('play.blocked')),
        h('div', { class: 'cover-sub' }, t('play.blocked.sub')),
        h('button', { class: 'btn primary', type: 'button', html: `${ICONS.play} ${t('play.playClip')}`, onclick: () => playPhase(game, i, isReplay) }));
      return;
    }
    showError(game, i, err, () => playPhase(game, i, isReplay));
    return;
  }
  if (!live(game, i)) return;
  if (isReplay) {
    if (game.phase !== 'replaying') return;
    game.phase = 'answering';
    askCover(game);
    resumeTimer();
    return;
  }
  answerPhase(game, i);
  if (i + 1 < game.questions.length) prepareQuestion(game, i + 1).catch(() => {});
}

function showError(game, i, err, retry) {
  game.phase = 'error';
  console.error(err);
  cover('error',
    h('div', { class: 'cover-status' }, t('play.failed')),
    h('div', { class: 'cover-sub' }, err.message || String(err)),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', type: 'button', onclick: retry }, t('play.retry')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => skipQuestion(game, i) }, t('play.skip'))));
}

function skipQuestion(game, i) {
  if (!live(game, i)) return;
  const q = game.questions[i];
  q.answer = null;
  q.correct = false;
  q.reason = 'skipped';
  goNext();
}

function askCover(game) {
  const practice = isPractice(game.settings);
  cover('ask', ring(h('div', { class: 'cover-big' }, '?'), 1), h('div', { class: 'cover-status' }, t('play.which')),
    h('div', { class: 'cover-sub' }, t(practice ? 'play.think.sub' : 'play.which.sub')));
}

const canReplay = (game) => isPractice(game.settings) || game.settings.allowReplay;

function answerPhase(game, i) {
  const q = game.questions[i];
  game.phase = 'answering';
  askCover(game);
  const practice = isPractice(game.settings);
  els.options.setAttribute('aria-label', t('play.choices'));
  els.options.replaceChildren(...(practice ? [] : q.options.map((s, k) =>
    h('button', { type: 'button', class: 'option', dataset: { id: s.id }, onclick: () => answer(game, i, s) },
      h('span', { class: 'num' }, String(k + 1)),
      songLine(s)))));
  const bar = [];
  if (canReplay(game)) {
    bar.push(h('button', { type: 'button', class: 'btn sm', html: `${ICONS.replay} ${t('play.replay')} <span class="kbd">R</span>`, onclick: () => replay(game, i) }));
  }
  bar.push(h('span', { class: 'spacer' }));
  if (practice) {
    bar.push(h('button', { type: 'button', class: 'btn primary', html: `${ICONS.eye} ${t('play.show')}`, onclick: () => answer(game, i, null, 'shown') }));
  } else {
    bar.push(h('button', { type: 'button', class: 'btn ghost sm', onclick: () => answer(game, i, null, 'gaveup') }, t('play.giveUp')));
  }
  els.answerBar.replaceChildren(...bar);
  els.answerBar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (practice) {
    const show = els.answerBar.querySelector('.btn.primary');
    if (show) show.focus({ preventScroll: true });
    return;
  }
  startTimer(game.settings.noLimit ? null : game.settings.thinkTime, () => answer(game, i, null, 'timeout'));
}

function replay(game, i) {
  if (!live(game, i) || game.phase !== 'answering') return;
  pauseTimer();
  playPhase(game, i, true);
}

/* ---------- thinking timer ---------- */
const timer = { limit: null, t0: 0, paused: 0, pausedAt: null, raf: 0, onEnd: null };
let quitDialogOpen = false;   // the thinking time stands still while "Quit this quiz?" is open

function startTimer(limit, onEnd) {
  stopTimer();
  const now = performance.now();
  Object.assign(timer, { limit, t0: now, paused: 0, pausedAt: quitDialogOpen ? now : null, onEnd });
  const wrap = $('#timer');
  wrap.hidden = false;
  wrap.classList.remove('low');
  if (limit == null) {
    $('#timer-fill').style.transform = 'scaleX(1)';
    $('#timer-num').textContent = '∞';
    return;
  }
  const tick = () => {
    const now = timer.pausedAt ?? performance.now();
    const left = Math.max(0, limit - (now - timer.t0 - timer.paused) / 1000);
    $('#timer-fill').style.transform = `scaleX(${left / limit})`;
    $('#timer-num').textContent = `${left.toFixed(1)}s`;
    wrap.classList.toggle('low', left <= Math.min(3, limit * 0.3));
    if (left <= 0) {
      const fn = timer.onEnd;
      stopTimer(true);
      if (fn) fn();
      return;
    }
    timer.raf = requestAnimationFrame(tick);
  };
  timer.raf = requestAnimationFrame(tick);
}
function pauseTimer() { if (timer.pausedAt == null) timer.pausedAt = performance.now(); }
function resumeTimer() {
  if (quitDialogOpen) return; // closing the dialog resumes it
  if (timer.pausedAt != null) { timer.paused += performance.now() - timer.pausedAt; timer.pausedAt = null; }
}
function thinkingMs() {
  const now = timer.pausedAt ?? performance.now();
  return now - timer.t0 - timer.paused;
}
function stopTimer(keepVisible = false) {
  cancelAnimationFrame(timer.raf);
  timer.onEnd = null;
  if (!keepVisible) $('#timer').hidden = true;
}

/* ---------- answer + reveal ---------- */
let autoNextTimer = 0;

function answer(game, i, song, reason = null) {
  if (!live(game, i) || (game.phase !== 'answering' && game.phase !== 'replaying')) return;
  const q = game.questions[i];
  const practice = isPractice(game.settings);
  q.timeMs = practice ? null : thinkingMs();
  stopTimer(!practice);
  q.answer = song ? song.id : null;
  q.correct = !!song && song.id === q.song.id;
  q.reason = reason;
  if (q.correct) game.correct++;
  game.phase = 'reveal';

  for (const b of els.options.children) {
    b.disabled = true;
    if (b.dataset.id === q.song.id) {
      b.classList.add('correct');
      b.append(h('span', { class: 'mark', 'aria-label': t('v.correct') }, '✓'));
    } else if (song && b.dataset.id === song.id) {
      b.classList.add('wrong');
      b.append(h('span', { class: 'mark', 'aria-label': t('v.wrong') }, '✗'));
    } else {
      b.classList.add('dim');
    }
  }
  els.answerBar.replaceChildren();
  renderTop();
  reveal(game, i, song);
}

function clipTimes(game, q) {
  const v = q.src.toVideo(q.clip.start);
  return { v, range: `${fmtTime(v)}–${fmtTime(v + game.settings.clipLen)}` };
}

function clipLabel(game, q) {
  const { range } = clipTimes(game, q);
  const label = t('clipLabel', { range });
  return q.clip.chorusIndex >= 0 ? `${label} (${t('chorusN', { n: q.clip.chorusIndex + 1 })})` : label;
}

function reportButton(game, q, small = false) {
  return h('button', {
    type: 'button', class: `btn ghost sm${small ? ' icon' : ''}`, title: t('report'), 'aria-label': t('report'),
    html: small ? ICONS.flag : `${ICONS.flag} ${t('report')}`,
    onclick: () => openReport({ song: q.song, src: q.src, clip: q.clip, mode: game.settings.mode, clipLen: game.settings.clipLen }),
  });
}

function reveal(game, i, chosen) {
  const q = game.questions[i];
  const s = q.song;
  const last = i + 1 >= game.questions.length;
  const practice = isPractice(game.settings);
  cover('revealed');
  if (game.settings.revealPlay) players[i % 2].resume(game.settings.volume);
  else players[i % 2].stop(0, game.settings.volume);

  let verdict;
  if (practice) {
    verdict = h('span', { class: 'verdict', html: `${ICONS.eye} ${t('v.answer')}` });
  } else if (q.correct) {
    verdict = h('span', { class: 'verdict ok', html: `${ICONS.check} ${t('v.correct')}` });
  } else {
    const key = chosen ? 'v.wrong' : q.reason === 'gaveup' ? 'v.gaveUp' : 'v.timeout';
    verdict = h('span', { class: 'verdict ng', html: `${ICONS.x} ${t(key)}` });
  }
  const nextBtn = h('button', { type: 'button', class: 'btn primary', onclick: goNext },
    last ? t(practice ? 'finish' : 'seeResults') : t(practice ? 'next.practice' : 'next'), h('span', { html: ICONS.next }));
  const meta = [englishTitle(s), `${s.album} · ${s.year}`, `${clipLabel(game, q)} · ${t(q.src.kind === 'mv' ? 'src.mv' : 'src.audio')}`];
  els.reveal.replaceChildren(
    h('div', {},
      verdict,
      h('p', { class: 'reveal-title', lang: 'ja' }, s.title),
      h('div', { class: 'reveal-meta' }, meta.filter(Boolean).join('  ·  '))),
    h('div', { class: 'reveal-actions' },
      reportButton(game, q),
      s.mvId ? h('a', { class: 'btn ghost sm', href: youtubeUrl(s.mvId), target: '_blank', rel: 'noopener', html: `${t('watchMv')} ${ICONS.ext}` }) : null,
      nextBtn));
  els.reveal.hidden = false;
  nextBtn.focus({ preventScroll: true });
  els.reveal.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  clearTimeout(autoNextTimer);
  if (game.settings.autoNext) {
    autoNextTimer = setTimeout(function next() {
      if (!live(game, i) || game.phase !== 'reveal') return;
      if (quitDialogOpen) autoNextTimer = setTimeout(next, 500);
      else goNext();
    }, AUTO_NEXT_MS);
  }
}

function goNext() {
  const game = quiz;
  if (!game || game.over || game.phase === 'results') return;
  clearTimeout(autoNextTimer);
  const i = game.index;
  if (game.questions[i] && game.questions[i].answer === undefined && game.phase !== 'error') return;
  players[i % 2]?.stop(220, game.settings.volume);
  if (i + 1 >= game.questions.length) showResults(game);
  else runQuestion(game, i + 1);
}

/* ---------- results ---------- */
let resultsPlayOp = 0;

function showResults(game) {
  game.phase = 'results';
  game.index = game.questions.length;
  clearPanel();
  $('#question-panel').hidden = true;
  const practice = isPractice(game.settings);
  const qs = game.questions;
  const n = qs.length;
  renderTop();
  setActiveSlot(0);
  const modeLine = t('res.modeLine', { mode: modeName(game.settings.mode), len: fmtSec(game.settings.clipLen) });
  const head = [];
  if (practice) {
    cover('score', h('div', { class: 'cover-status' }, t('res.practiceDone')),
      h('div', { class: 'cover-sub' }, `${t('hint.clips', { n })} · ${modeLine}`));
  } else {
    const pct = Math.round((game.correct / n) * 100);
    const times = qs.filter((q) => q.answer).map((q) => q.timeMs / 1000);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const msg = t(pct === 100 ? 'res.perfect' : pct >= 80 ? 'res.excellent' : pct >= 50 ? 'res.nice' : 'res.keep');
    cover('score', h('div', { class: 'cover-big' }, `${game.correct}/${n}`),
      h('div', { class: 'cover-status' }, msg),
      h('div', { class: 'cover-sub' }, modeLine));
    head.push(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, `${game.correct}/${n}`), h('span', {}, t('res.correct'))),
      h('div', { class: 'stat' }, h('b', {}, `${pct}%`), h('span', {}, t('res.accuracy'))),
      h('div', { class: 'stat' }, h('b', {}, avg == null ? '–' : `${avg.toFixed(1)}s`), h('span', {}, t('res.avg')))));
  }

  const panel = $('#results-panel');
  panel.replaceChildren(...[
    h('div', { class: 'results-head' },
      h('h2', {}, t(practice ? 'res.heard' : 'res.answers')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: backToSetup }, t('res.settings')),
        h('button', { type: 'button', class: 'btn primary', html: `${ICONS.replay} ${t('res.again')}`, onclick: () => { stopAllPlayers(); startQuiz(); } }))),
    ...head,
    game.replaced ? h('p', { class: 'small muted' }, t('res.replaced', { n: game.replaced })) : null,
    h('ol', { class: 'result-list' }, ...qs.map((q, k) => {
      const yours = q.answer ? songs.find((s) => s.id === q.answer) : null;
      const why = t({ skipped: 'res.skipped', gaveup: 'res.gaveUp', timeout: 'res.timeout' }[q.reason] || 'res.none');
      let detail;
      if (practice) detail = clipLabel(game, q);
      else if (q.correct) detail = `${clipLabel(game, q)} · ${(q.timeMs / 1000).toFixed(1)}s`;
      else detail = [`${clipLabel(game, q)} · `, yours ? h('b', { lang: 'ja' }, t('res.you', { title: yours.title })) : h('b', {}, why)];
      const mark = practice ? h('span', { class: 'res' }, String(k + 1))
        : h('span', { class: 'res', 'aria-label': t(q.correct ? 'v.correct' : 'v.wrong') }, q.correct ? '✓' : '✗');
      return h('li', { class: `result-item ${practice ? 'neutral' : q.correct ? 'ok' : 'ng'}` },
        mark,
        h('div', {},
          h('div', { class: 'song' }, h('span', { lang: 'ja' }, practice ? q.song.title : `${k + 1}. ${q.song.title}`),
            englishTitle(q.song) ? h('span', { class: 'r' }, ` · ${englishTitle(q.song)}`) : null),
          h('div', { class: 'detail' }, detail)),
        h('div', { class: 'acts' },
          h('button', {
            type: 'button', class: 'btn sm icon', 'aria-label': t('res.playAgain', { n: k + 1 }), title: t('res.playAgain', { n: k + 1 }),
            html: ICONS.play, onclick: () => replayFromResults(game, q),
          }),
          reportButton(game, q, true),
          h('a', {
            class: 'btn sm icon', href: youtubeUrl(q.src.videoId, clipTimes(game, q).v), target: '_blank', rel: 'noopener',
            'aria-label': t('res.open'), title: t('res.open'), html: ICONS.ext,
          })));
    })),
  ].filter(Boolean));
  panel.hidden = false;
}

async function replayFromResults(game, q) {
  const op = ++resultsPlayOp;
  const p = players[0];
  setActiveSlot(0);
  cover('loading', h('div', { class: 'spinner' }), h('div', { class: 'cover-status', lang: 'ja' }, q.song.title));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const v = clipTimes(game, q).v;
  try {
    players[1].stop(0);
    await p.prepare(q.src.videoId, v);
    if (op !== resultsPlayOp || quiz !== game) return;
    cover('revealed');
    await p.playClip(v, game.settings.clipLen, { volume: game.settings.volume });
  } catch (err) {
    if (err instanceof CancelledError || op !== resultsPlayOp) return;
    toast(err.message, 'bad');
  }
}

/* ---------- leaving ---------- */
function stopAllPlayers() {
  for (const p of players) p.stop(120, settings.volume);
}

function backToSetup() {
  if (quiz) quiz.over = true;
  clearTimeout(autoNextTimer);
  stopTimer();
  resultsPlayOp++;
  stopAllPlayers();
  $('#play').hidden = true;
  $('#setup').hidden = false;
  updateStartHint();
}

async function quit() {
  const game = quiz;
  if (!game || game.over) return;
  if (game.phase === 'results') { backToSetup(); return; }
  if (quitDialogOpen) return;
  pauseTimer();
  quitDialogOpen = true;
  const practice = isPractice(game.settings);
  const ok = await confirmDialog(t(practice ? 'quit.titlePractice' : 'quit.title'), t(practice ? 'quit.textPractice' : 'quit.text'),
    t('quit.yes'), t('quit.no'));
  quitDialogOpen = false;
  if (ok) backToSetup();
  // the clip may have ended (or a replay finished) while the dialog was open
  else if (quiz === game && game.phase === 'answering') resumeTimer();
}

/* =====================================================================
   Keyboard: 1-4 answer · R replay · Enter/Space/→ next · Esc quit
   Practice: R replay · Enter/Space show the answer, then next
   ===================================================================== */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (document.querySelector('.modal-back')) return;
  const game = quiz;
  if (!game || game.over || $('#play').hidden) return;
  const i = game.index;
  const practice = isPractice(game.settings);
  if (e.key === 'Escape') { e.preventDefault(); quit(); return; }
  if (game.phase === 'answering' || game.phase === 'replaying') {
    const k = Number(e.key);
    if (!practice && k >= 1 && k <= 4) {
      e.preventDefault();
      answer(game, i, game.questions[i].options[k - 1]);
    } else if ((e.key === 'r' || e.key === 'R') && canReplay(game)) {
      e.preventDefault();
      replay(game, i);
    } else if (practice && (e.key === 'Enter' || e.key === ' ')) {
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      answer(game, i, null, 'shown');
    }
  } else if (game.phase === 'reveal' && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
    // a focused button/link already reacts to Enter/Space by itself
    if (e.key !== 'ArrowRight' && e.target.closest('button, a')) return;
    e.preventDefault();
    goNext();
  }
});

/* =====================================================================
   Boot
   ===================================================================== */
function renderLanguagePicker() {
  els.lang.replaceChildren(...LANGS.map((l) => h('option', { value: l.code }, l.label)));
  els.lang.value = lang();
  els.lang.addEventListener('change', () => {
    setLang(els.lang.value);
    applyStatic();
    if (songs.length) renderSetup();
    if (quiz && !quiz.over) {
      renderPill(quiz);
      renderTop();
      if (quiz.phase === 'results') showResults(quiz);
    }
  });
}

async function boot() {
  els.modeGrid = $('#mode-grid');
  els.stage = $('#stage');
  els.cover = $('#cover');
  els.coverInner = $('#cover-inner');
  els.options = $('#options');
  els.answerBar = $('#answer-bar');
  els.reveal = $('#reveal');
  els.qcount = $('#qcount');
  els.scorebox = $('#scorebox');
  els.dots = $('#dots');
  els.modePill = $('#mode-pill');
  els.lang = $('#lang');
  $('#brand-mark').innerHTML = ICONS.logo;
  $('#lang-icon').innerHTML = ICONS.globe;
  $('#quit').innerHTML = ICONS.close;
  $('#editor-link').insertAdjacentHTML('afterbegin', ICONS.edit);
  $('#editor-link').hidden = !isLocal();
  $('#start').insertAdjacentHTML('afterbegin', ICONS.play);
  repaintTheme = initTheme($('#theme-toggle'), (light) => t(light ? 'theme.dark' : 'theme.light'));
  renderLanguagePicker();
  applyStatic();

  if (location.protocol === 'file:') {
    $('#start').disabled = true;
    $('#start-hint').textContent = t('hint.file');
    $('#start-hint').classList.add('warn');
    return;
  }
  try {
    songs = await loadSongs();
  } catch (err) {
    console.error(err);
    $('#start').disabled = true;
    $('#start-hint').textContent = t('hint.load');
    $('#start-hint').classList.add('warn');
    return;
  }
  if (Array.isArray(settings.pool)) {
    const known = new Set(songs.map((s) => s.id));
    settings.pool = settings.pool.filter((id) => known.has(id));
  }
  if (!MODES[settings.mode]) settings.mode = DEFAULTS.mode;

  renderSetup();

  $('#pool-toggle').addEventListener('click', (e) => {
    const pool = $('#pool');
    pool.hidden = !pool.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!pool.hidden));
    e.currentTarget.textContent = pool.hidden ? t('songs.choose') : t('songs.done');
  });
  $('#start').addEventListener('click', startQuiz);
  $('#quit').addEventListener('click', quit);
}

boot();
