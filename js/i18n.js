// Interface text in three languages. One language is shown at a time; song titles stay
// Japanese with their English title underneath. The language picker itself is always English.
import { store } from './common.js';

const LANG_KEY = 'yq.lang';
export const LANGS = [
  { code: 'en', label: 'English', html: 'en' },
  { code: 'zh', label: 'Traditional Chinese', html: 'zh-Hant' },
  { code: 'ja', label: 'Japanese', html: 'ja' },
];

const s = (n, en, zh, ja) => [n, { en, zh, ja }];
const plural = (one, many) => (p) => (Number(p.n) === 1 ? one : many).replace('{n}', p.n);

const STRINGS = Object.fromEntries([
  s('title', 'YOASOBI Song Quiz', 'YOASOBI 猜歌測驗', 'YOASOBI 曲当てクイズ'),
  s('brand.sub', 'Song Quiz', '猜歌測驗', '曲当てクイズ'),
  s('hero.a', 'Can you name ', '這首歌，', 'この曲、'),
  s('hero.b', 'this song?', '你聽得出來嗎？', 'わかる？'),
  s('hero.p', 'A short clip of a YOASOBI song plays. Can you tell which one it is?',
    '播放 YOASOBI 歌曲的一小段，猜猜是哪一首。', 'YOASOBIの曲の一部が流れます。どの曲かわかりますか？'),
  s('editor', 'Timing editor', '時間編輯器', 'タイミング編集'),
  s('theme.light', 'Switch to light theme', '切換為淺色主題', 'ライトテーマに切り替え'),
  s('theme.dark', 'Switch to night theme', '切換為深色主題', 'ナイトテーマに切り替え'),

  s('style.title', 'Play style', '玩法', '遊び方'),
  s('style.quiz', 'Quiz', '測驗', 'クイズ'),
  s('style.quiz.desc', 'Four choices, a timer and a score.', '四選一、限時作答並計分。', '4択・制限時間・スコアあり。'),
  s('style.practice', 'Practice', '練習', '練習'),
  s('style.practice.desc', 'No choices and no score: listen, then show the answer.',
    '沒有選項也不計分：聽完再顯示答案。', '選択肢もスコアもなし。聴いてから答えを表示します。'),

  s('mode.title', 'Mode', '模式', 'モード'),
  s('mode.chorus', 'Chorus', '副歌', 'サビ'),
  s('mode.chorus.desc', 'Every clip starts right at a chorus.', '每段都從副歌開頭播放。', '必ずサビの頭から再生します。'),
  s('mode.random', 'Anywhere', '隨機', 'ランダム'),
  s('mode.random.desc', 'A random clip from anywhere in the song.', '從歌曲任意位置隨機播放。', '曲のどこからでもランダムに再生します。'),
  s('mode.nochorus', 'No chorus', '非副歌', 'サビ以外'),
  s('mode.nochorus.desc', 'A random clip that never touches a chorus. Hard!',
    '隨機播放不含副歌的片段。很難！', 'サビを含まない部分からランダムに再生。難しい！'),

  s('count', 'Number of questions', '題數', '問題数'),
  s('count.practice', 'Number of clips', '播放幾段', '再生する数'),
  s('clip', 'Clip length', '片段長度', '再生の長さ'),
  s('think', 'Thinking time', '作答時間', '回答時間'),
  s('think.none', 'No limit', '不限時', '無制限'),
  s('think.chip', '∞ No limit', '∞ 不限時', '∞ 無制限'),
  s('sec', '{n} s', '{n} 秒', '{n}秒'),
  s('presets.clip', 'Clip length presets', '片段長度預設值', '再生の長さのプリセット'),
  s('presets.think', 'Thinking time presets', '作答時間預設值', '回答時間のプリセット'),

  s('songs', 'Songs', '歌曲', '曲'),
  s('songs.choose', 'Choose songs', '選擇歌曲', '曲を選ぶ'),
  s('songs.done', 'Done', '完成', '完了'),
  s('songs.count', '{n} of {total} songs', '已選 {n} / {total} 首', '{total}曲中{n}曲'),
  s('songs.all', 'Select all', '全選', 'すべて選択'),
  s('songs.clear', 'Clear', '清除', 'クリア'),
  s('album.all', 'All', '全選', 'すべて'),
  s('album.none', 'None', '全不選', 'なし'),

  s('more', 'More options', '更多選項', 'その他の設定'),
  s('volume', 'Volume', '音量', '音量'),
  s('opt.allowReplay', 'Allow replaying the clip', '允許重播片段', 'もう一度聴けるようにする'),
  s('opt.allowReplay.desc', 'Adds a replay button while you think (the timer pauses).',
    '作答時顯示重播按鈕（計時會暫停）。', '考えている間に再生ボタンを表示します（タイマーは止まります）。'),
  s('opt.revealPlay', 'Keep playing after you answer', '作答後繼續播放', '回答後も再生を続ける'),
  s('opt.revealPlay.desc', 'The song continues from the end of the clip while the answer is shown.',
    '顯示答案時，歌曲會從片段結尾繼續播放。', '答えの表示中、クリップの続きから曲が流れます。'),
  s('opt.autoNext', 'Auto-advance', '自動下一題', '自動で次へ'),
  s('opt.autoNext.desc', 'Go to the next question 5 s after the answer is shown.',
    '顯示答案 5 秒後自動進入下一題。', '答えの表示から5秒後に次へ進みます。'),

  s('start.quiz', 'Start quiz', '開始測驗', 'クイズ開始'),
  s('start.practice', 'Start practice', '開始練習', '練習開始'),
  s('hint.min4', 'Pick at least 4 songs so there are four choices.', '請至少選擇 4 首歌，才能有四個選項。', '4択にするため、4曲以上選んでください。'),
  s('hint.min1', 'Pick at least one song.', '請至少選擇 1 首歌。', '1曲以上選んでください。'),
  s('hint.noroom', 'No selected song has room for a {len} clip in {mode} mode. Try a shorter clip.',
    '所選歌曲在「{mode}」模式中放不下 {len} 的片段，請縮短片段長度。',
    '選んだ曲には「{mode}」モードで{len}の再生区間がありません。短くしてください。'),
  s('hint.leftout', 'Left out: {n} song(s) where a {len} clip doesn\'t fit in this mode.',
    '有 {n} 首歌在此模式放不下 {len} 的片段，已排除。', '{n}曲はこのモードで{len}の区間が取れないため除外します。'),
  s('hint.repeat', '{songs} songs for {count} questions, so some songs will repeat.',
    '{count} 題只有 {songs} 首歌，部分歌曲會重複。', '{count}問に対して{songs}曲なので、同じ曲が出ることがあります。'),
  s('hint.summary', '{count} · {len} clips · {time}', '{count} · 每段 {len} · {time}', '{count} · 再生{len} · {time}'),
  s('hint.questions', plural('{n} question', '{n} questions'), '{n} 題', '{n}問'),
  s('hint.clips', plural('{n} clip', '{n} clips'), '{n} 段', '{n}回'),
  s('hint.answerIn', '{len} to answer', '作答 {len}', '回答{len}'),
  s('hint.noTime', 'no time limit', '不限時間', '時間制限なし'),
  s('hint.practice', 'no choices, no score', '沒有選項、不計分', '選択肢・スコアなし'),
  s('hint.load', 'Could not load the song list. Check your connection and reload the page.',
    '無法載入歌曲清單。請檢查網路連線後重新整理頁面。', '曲リストを読み込めませんでした。接続を確認してページを再読み込みしてください。'),
  s('hint.file', 'Open the quiz through its little server: double-click start.bat (or run "python server.py").',
    '請透過本機伺服器開啟：雙擊 start.bat（或執行 "python server.py"）。',
    'ローカルサーバー経由で開いてください：start.bat をダブルクリック（または "python server.py" を実行）。'),

  s('play.q', 'Q{n}', '第 {n} 題', '{n}問目'),
  s('play.clip', 'Clip {n}', '第 {n} 段', '{n}回目'),
  s('play.results', 'Results', '結果', '結果'),
  s('play.correct', '{n} correct', '答對 {n} 題', '{n}問正解'),
  s('play.quit', 'Quit', '結束', 'やめる'),
  s('play.starting', 'Starting the player…', '正在啟動播放器…', 'プレイヤーを準備中…'),
  s('play.noPlayer', 'The YouTube player could not start', '無法啟動 YouTube 播放器', 'YouTubeプレイヤーを起動できませんでした'),
  s('play.tryAgain', 'Try again', '重試', '再試行'),
  s('play.back', 'Back', '返回', '戻る'),
  s('play.loading', 'Loading clip…', '載入片段中…', '読み込み中…'),
  s('play.of', 'Question {n} of {total}', '第 {n} 題，共 {total} 題', '{total}問中{n}問目'),
  s('play.ofClips', 'Clip {n} of {total}', '第 {n} 段，共 {total} 段', '{total}回中{n}回目'),
  s('play.ready', 'Get ready…', '準備…', '準備して…'),
  s('play.listen', 'Listen…', '仔細聽…', 'よく聴いて…'),
  s('play.replaying', 'Replay…', '重播中…', 'もう一度…'),
  s('play.clipLen', '{len} clip', '{len} 片段', '{len}の再生'),
  s('play.blocked', 'Your browser paused the audio', '瀏覽器暫停了聲音', 'ブラウザが音声を止めました'),
  s('play.blocked.sub', 'Click to allow sound and play the clip.', '點一下以允許聲音並播放片段。', 'クリックして音声を許可し、再生してください。'),
  s('play.playClip', 'Play clip', '播放片段', '再生'),
  s('play.failed', 'This clip could not be played', '無法播放這個片段', 'この部分を再生できませんでした'),
  s('play.retry', 'Retry', '重試', '再試行'),
  s('play.skip', 'Skip question', '跳過此題', 'スキップ'),
  s('play.which', 'Which song is it?', '是哪一首歌？', 'どの曲？'),
  s('play.which.sub', 'Press 1–4 or click an answer', '按 1–4 或點選答案', '1〜4キーか、答えをクリック'),
  s('play.think.sub', 'Think, then show the answer', '想好之後再顯示答案', '考えたら答えを表示'),
  s('play.replay', 'Replay', '重播', 'もう一度'),
  s('play.giveUp', 'Give up', '放棄', 'あきらめる'),
  s('play.show', 'Show answer', '顯示答案', '答えを見る'),
  s('play.choices', 'Answer choices', '答案選項', '選択肢'),

  s('v.correct', 'Correct!', '答對了！', '正解！'),
  s('v.wrong', 'Not quite', '答錯了', '不正解'),
  s('v.gaveUp', 'Gave up', '放棄', 'ギブアップ'),
  s('v.timeout', "Time's up", '時間到', '時間切れ'),
  s('v.answer', 'The answer', '答案', '答え'),
  s('src.mv', 'official MV', '官方 MV', '公式MV'),
  s('src.audio', 'audio track', '音源', '音源'),
  s('clipLabel', 'clip {range}', '片段 {range}', '再生 {range}'),
  s('chorusN', 'chorus {n}', '副歌 {n}', 'サビ{n}'),
  s('watchMv', 'Watch MV', '觀看 MV', 'MVを見る'),
  s('next', 'Next', '下一題', '次へ'),
  s('next.practice', 'Next', '下一段', '次へ'),
  s('seeResults', 'See results', '查看結果', '結果を見る'),
  s('finish', 'Finish', '結束', '終了'),
  s('report', 'Report chorus time', '回報副歌時間', 'サビの時間を報告'),

  s('res.answers', 'Your answers', '你的答案', 'あなたの回答'),
  s('res.heard', 'Songs you heard', '聽過的歌', '聴いた曲'),
  s('res.settings', 'Settings', '設定', '設定'),
  s('res.again', 'Play again', '再玩一次', 'もう一度'),
  s('res.correct', 'correct', '答對', '正解'),
  s('res.accuracy', 'accuracy', '正確率', '正答率'),
  s('res.avg', 'avg. answer time', '平均作答時間', '平均回答時間'),
  s('res.replaced', '{n} song(s) wouldn\'t play on YouTube here, so other songs were used instead.',
    '有 {n} 首歌無法在這裡透過 YouTube 播放，已改用其他歌曲。', '{n}曲はここではYouTubeで再生できなかったため、別の曲にしました。'),
  s('res.skipped', 'skipped', '已跳過', 'スキップ'),
  s('res.gaveUp', 'gave up', '放棄', 'ギブアップ'),
  s('res.timeout', "time's up", '時間到', '時間切れ'),
  s('res.none', 'no answer', '未作答', '未回答'),
  s('res.you', 'you: {title}', '你的答案：{title}', 'あなた：{title}'),
  s('res.playAgain', 'Play clip {n} again', '再次播放第 {n} 段', '{n}番目をもう一度再生'),
  s('res.open', 'Open on YouTube at this time', '在 YouTube 從這個時間開啟', 'この位置からYouTubeで開く'),
  s('res.perfect', 'Perfect!', '完美！', '完璧で究極！'),
  s('res.excellent', 'Excellent!', '太厲害了！', 'すばらしい！'),
  s('res.nice', 'Nice work!', '做得好！', 'いいね！'),
  s('res.keep', 'Keep listening!', '繼續加油！', 'もっと聴いてみよう！'),
  s('res.modeLine', '{mode} mode · {len} clips', '{mode}模式 · 每段 {len}', '{mode}モード · 再生{len}'),
  s('res.practiceDone', 'Practice finished', '練習結束', '練習終了'),

  s('quit.title', 'Quit this quiz?', '要結束這次測驗嗎？', 'クイズをやめますか？'),
  s('quit.text', 'Your answers in this round will be lost.', '這一輪的答案不會保留。', 'このラウンドの回答は保存されません。'),
  s('quit.titlePractice', 'Stop practicing?', '要結束練習嗎？', '練習をやめますか？'),
  s('quit.textPractice', 'You can start again any time.', '隨時可以重新開始。', 'いつでもまた始められます。'),
  s('quit.yes', 'Quit', '結束', 'やめる'),
  s('quit.no', 'Keep playing', '繼續', '続ける'),

  s('rep.title', 'Report a chorus time', '回報副歌時間', 'サビの時間を報告'),
  s('rep.intro', 'Tell us what is off about this clip. Reports help fix the timings for everyone.',
    '告訴我們這個片段哪裡不對，你的回報能幫大家修正時間。', 'この部分の何がおかしいか教えてください。報告はタイミングの修正に役立ちます。'),
  s('rep.what', 'What is wrong?', '哪裡不對？', '何が違いますか？'),
  s('rep.start', 'The chorus starts at a different time', '副歌開始的時間不對', 'サビの始まる時間が違う'),
  s('rep.notChorus', 'This part isn\'t the chorus', '這段不是副歌', 'この部分はサビではない'),
  s('rep.offset', 'The clip doesn\'t start where it should in the video', '片段在影片中的位置不對', '動画の再生位置がずれている'),
  s('rep.other', 'Something else', '其他', 'その他'),
  s('rep.time', 'Better start time (as shown on YouTube, e.g. 1:15.2)', '建議的開始時間（YouTube 上顯示的時間，例如 1:15.2）',
    '正しい開始時間（YouTube上の表示、例：1:15.2）'),
  s('rep.comment', 'Comment (optional)', '說明（選填）', 'コメント（任意）'),
  s('rep.send', 'Open report on GitHub', '在 GitHub 回報', 'GitHubで報告する'),
  s('rep.note', 'Opens a filled-in report on GitHub. You need a free GitHub account to send it.',
    '會開啟已填好內容的 GitHub 回報頁面，需要免費的 GitHub 帳號才能送出。',
    '入力済みの報告をGitHubで開きます。送信には無料のGitHubアカウントが必要です。'),
  s('rep.copy', 'Copy text', '複製內容', 'テキストをコピー'),
  s('rep.copied', 'Copied', '已複製', 'コピーしました'),
  s('rep.cancel', 'Cancel', '取消', 'キャンセル'),
  s('rep.badTime', 'Use minutes:seconds, e.g. 1:15.2', '請用「分:秒」格式，例如 1:15.2', '「分:秒」で入力してください（例：1:15.2）'),
]);

let current = null;

function detect() {
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const x = String(l).toLowerCase();
    if (x.startsWith('zh')) return 'zh';
    if (x.startsWith('ja')) return 'ja';
    if (x.startsWith('en')) return 'en';
  }
  return 'en';
}

export function lang() {
  if (!current) {
    const saved = store.get(LANG_KEY, null);
    current = LANGS.some((l) => l.code === saved) ? saved : detect();
  }
  return current;
}

export function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  current = code;
  store.set(LANG_KEY, code);
}

export const htmlLang = () => LANGS.find((l) => l.code === lang()).html;

/** Text for `key` in the current language; {name} placeholders are filled from `params`. */
export function t(key, params = {}) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let v = entry[lang()] ?? entry.en;
  if (typeof v === 'function') v = v(params);
  return v.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

/** For tests: every key with its three translations. */
export const ALL_STRINGS = STRINGS;
