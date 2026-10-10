// "Report chorus time": a small form that opens a filled-in GitHub issue (or copies the text).
import { h, fmtTime, parseTime, youtubeUrl, englishTitle, toast } from './common.js';
import { t } from './i18n.js';
import { toAudio } from './sources.js';

export const REPORT_REPO = 'fuyo1622/yoasobi-song-quiz';
const PROBLEMS = ['start', 'notChorus', 'offset', 'other'];
const PROBLEM_EN = {
  start: 'The chorus starts at a different time',
  notChorus: "This part isn't the chorus",
  offset: "The clip doesn't start where it should in the video",
  other: 'Something else',
};

/** The report's fields (always English, for the maintainer). */
export function reportFields({ song, src, clip, mode, clipLen }, problem, suggested, comment) {
  const vStart = src.toVideo(clip.start);
  const where = src.kind === 'mv' ? 'official MV' : 'audio track';
  const chorus = clip.chorusIndex >= 0 ? `, chorus ${clip.chorusIndex + 1}` : '';
  const fields = {
    song: `${song.title}${englishTitle(song) ? ` (${englishTitle(song)})` : ''} [${song.id}]`,
    video: `${where}: ${youtubeUrl(src.videoId, vStart)}`,
    clip: `${fmtTime(vStart, 2)}–${fmtTime(vStart + clipLen, 2)} on the ${where}${chorus}; ${mode} mode` +
      (src.kind === 'mv' ? ` (data time ${fmtTime(clip.start, 2)})` : ''),
    problem: PROBLEM_EN[problem] || PROBLEM_EN.other,
    suggested: '',
    comment: comment || '',
  };
  if (suggested != null) {
    fields.suggested = `${fmtTime(suggested, 2)} on the ${where}` +
      (src.kind === 'mv' ? ` (data time ${fmtTime(toAudio(src, song, suggested), 2)})` : '');
  }
  return fields;
}

export function issueUrl(info, fields) {
  const title = `Chorus time: ${info.song.title}${info.clip.chorusIndex >= 0 ? ` (chorus ${info.clip.chorusIndex + 1})` : ''}`;
  const q = new URLSearchParams({ template: 'chorus-time.yml', title, ...fields });
  return `https://github.com/${REPORT_REPO}/issues/new?${q}`;
}

export function reportText(fields) {
  return Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** Show the report form for one clip. info: { song, src, clip, mode, clipLen } */
export function openReport(info) {
  return new Promise((resolve) => {
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const vStart = info.src.toVideo(info.clip.start);
    const radios = PROBLEMS.map((p, k) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'rep-problem', value: p, checked: k === 0 }), h('span', {}, t(`rep.${p}`))));
    const timeInput = h('input', { class: 'num-input', type: 'text', inputmode: 'decimal', id: 'rep-time',
      placeholder: fmtTime(vStart, 1), autocomplete: 'off' });
    const comment = h('textarea', { class: 'num-input', id: 'rep-comment', rows: 3, maxlength: 600 });
    const err = h('p', { class: 'small warn-text', role: 'alert', hidden: true }, t('rep.badTime'));
    const collect = () => {
      const problem = (radios.map((r) => r.querySelector('input')).find((x) => x.checked) || {}).value;
      const raw = timeInput.value.trim();
      const time = raw ? parseTime(raw) : null;
      if (raw && !(Number.isFinite(time) && time >= 0)) { err.hidden = false; timeInput.focus(); return null; }
      err.hidden = true;
      return reportFields(info, problem, time, comment.value.trim());
    };
    const send = h('button', { class: 'btn primary', type: 'button', onclick: () => {
      const fields = collect();
      if (!fields) return;
      window.open(issueUrl(info, fields), '_blank', 'noopener');
      close();
    } }, t('rep.send'));
    const copy = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      const fields = collect();
      if (!fields) return;
      try { await navigator.clipboard.writeText(reportText(fields)); toast(t('rep.copied'), 'good'); } catch { /* clipboard blocked */ }
    } }, t('rep.copy'));
    const sub = [info.song.title, englishTitle(info.song)].filter(Boolean).join(' · ');
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } },
      h('div', { class: 'modal report', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('rep.title') },
        h('h3', {}, t('rep.title')),
        h('p', { class: 'small muted' }, h('b', { lang: 'ja' }, sub), h('br'),
          `${t('clipLabel', { range: `${fmtTime(vStart)}–${fmtTime(vStart + info.clipLen)}` })} · ${t(info.src.kind === 'mv' ? 'src.mv' : 'src.audio')}`),
        h('p', { class: 'small' }, t('rep.intro')),
        h('fieldset', { class: 'radios' }, h('legend', { class: 'small' }, t('rep.what')), ...radios),
        h('label', { class: 'field small', for: 'rep-time' }, t('rep.time')), timeInput, err,
        h('label', { class: 'field small', for: 'rep-comment' }, t('rep.comment')), comment,
        h('p', { class: 'tiny muted' }, t('rep.note')),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('rep.cancel')), copy, send)));
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    radios[0].querySelector('input').focus();
  });
}
