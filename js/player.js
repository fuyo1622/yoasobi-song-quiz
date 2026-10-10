// YouTube IFrame API wrapper that can play an exact slice of a video.
//
// prepare(videoId, start) loads + buffers the video muted and leaves it paused just before
// `start`, so playClip(start, seconds) can start instantly. A clip is timed by the video's own
// position: playback starts PREROLL seconds early at volume 0 (so the audio output is already
// running), the sound opens exactly at `start`, and it stops at `start + seconds`. Buffering,
// a slow audio device or an ad before the content can therefore neither cut nor shift a clip.
//
// YouTube often plays an ad before an embedded video (on public sites; not on localhost). While it
// does, the player stays "unstarted", loads its "ad" module and its clock runs through the ad.
// prepare() spots that and either gives up at once (AdError, so the caller can pick another
// video) or waits and reports the ad, so the page can show it with YouTube's Skip button.

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
export const PREROLL = 0.25;
const OPEN_EARLY = 0.1;      // raising the volume reaches the iframe ~0.1 s later (measured)
const STOP_EARLY = 0.08;     // so does the pause command
const FADE_OUT = 0.15;
const CLIP_TICK_MS = 15;
const STALL_MS = 20000;      // no progress for this long while playing a clip = give up
const LOAD_MS = 30000;       // a video that hasn't started by then counts as stuck
const AD_CONFIRM_MS = 400;   // ad signs must last this long (they can flicker while a video loads)
const AD_WAIT_MS = 180000;   // how long to wait for an ad the viewer can see and skip

export class PlayerError extends Error {
  constructor(code) {
    const reasons = {
      2: 'invalid video id',
      5: 'HTML5 player error',
      100: 'video not found or removed',
      101: 'the owner does not allow embedding',
      150: 'the owner does not allow embedding (or not available in your region)',
      153: 'player configuration error (open the site through server.py, not as a file)',
    };
    super(`YouTube error ${code}: ${reasons[code] || 'unknown error'}`);
    this.name = 'PlayerError';
    this.code = code;
  }
}
export class CancelledError extends Error { constructor() { super('cancelled'); this.name = 'CancelledError'; } }
export class TimeoutError extends Error { constructor(what) { super(`timed out: ${what}`); this.name = 'TimeoutError'; } }
export class AutoplayBlockedError extends Error {
  constructor() { super('The browser blocked playback. Click play to continue.'); this.name = 'AutoplayBlockedError'; }
}
export class AdError extends Error { constructor() { super('YouTube is playing an ad first.'); this.name = 'AdError'; } }

let apiPromise = null;
export function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (location.protocol === 'file:') {
    return Promise.reject(new Error('Open the quiz through server.py (http://localhost:8000). YouTube videos do not play from file:// pages.'));
  }
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { apiPromise = null; reject(new Error('Could not load the YouTube player. Are you online?')); };
      document.head.append(s);
      setTimeout(() => {
        if (window.YT && window.YT.Player) return;
        apiPromise = null; // let the next attempt load it again
        reject(new Error('Timed out loading the YouTube player.'));
      }, 25000);
    });
  }
  return apiPromise;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ClipPlayer {
  /** @param {HTMLElement} host element the iframe is created in (should have a real size) */
  constructor(host, { controls = false, quality = 'small' } = {}) {
    this.host = host;
    this.controls = controls;
    this.quality = quality;
    this.player = null;
    this.state = STATE.UNSTARTED;
    this.errorCode = null;
    this.op = 0;
    this.videoId = null;
    this.ready = null;
    this.onStateChange = null;
  }

  init() {
    if (this.ready) return this.ready;
    const ready = (async () => {
      const YT = await loadYouTubeAPI();
      const mount = document.createElement('div');
      this.host.append(mount);
      try {
        await this._create(YT, mount);
      } catch (err) {
        try { this.player.destroy(); } catch { /* never created */ }
        this.player = null;
        mount.remove();
        throw err;
      }
      const iframe = this.player.getIframe();
      if (!this.controls) iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('title', 'YouTube player');
    })();
    this.ready = ready;
    // A failed start must not stick, so "Try again" really starts a new player.
    ready.catch(() => { if (this.ready === ready) this.ready = null; });
    return ready;
  }

  /** Create the YT.Player in `mount`; resolves when it is ready. */
  _create(YT, mount) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The YouTube player did not start.')), 25000);
      this.player = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: this.controls ? 1 : 0,
          disablekb: this.controls ? 0 : 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          modestbranding: 1,
          origin: location.origin,
          // The quiz only needs audio. Asking YouTube for its smallest rendition
          // avoids decoding a high-resolution video behind the quiz/editor UI.
          vq: this.quality,
        },
        events: {
          onReady: () => {
            clearTimeout(timer);
            try { this.player.setPlaybackQuality(this.quality); } catch { /* optional API */ }
            resolve();
          },
          onStateChange: (e) => {
            this.state = e.data;
            if (this.onStateChange) this.onStateChange(e.data);
          },
          onError: (e) => { this.errorCode = e.data; },
        },
      });
    });
  }

  time() {
    try { return this.player.getCurrentTime() || 0; } catch { return 0; }
  }

  duration() {
    try { return this.player.getDuration() || 0; } catch { return 0; }
  }

  isPlaying() {
    return this.state === STATE.PLAYING || this.state === STATE.BUFFERING;
  }

  /** Poll `check` until it returns truthy; rejects on player error, timeout or cancellation. */
  _poll(check, timeoutMs, op, what) {
    const limit = typeof timeoutMs === 'function' ? timeoutMs : () => timeoutMs;
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const tick = () => {
        if (op !== this.op) return reject(new CancelledError());
        if (this.errorCode != null) {
          const code = this.errorCode;
          this.errorCode = null;
          return reject(new PlayerError(code));
        }
        let res;
        try { res = check(); } catch (err) { return reject(err); }
        if (res) return resolve(res);
        if (performance.now() - t0 > limit()) return reject(new TimeoutError(what));
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  _hasAdModule() {
    try { return (this.player.getOptions() || []).includes('ad'); } catch { return false; }   // not in every player version
  }

  /**
   * Load + buffer `videoId` muted and park it (paused) just before `start`. If an ad plays
   * first: with `skipAds` it fails at once with an AdError; otherwise it waits for the ad (up to
   * AD_WAIT_MS), calling onAd(seconds into the ad) while one plays and onAd(null) when it is over.
   */
  async prepare(videoId, start, { skipAds = false, onAd } = {}) {
    await this.init();
    const op = ++this.op;
    this.errorCode = null;
    const p = this.player;
    const from = Math.max(0, start - PREROLL);
    p.mute();
    if (this.videoId !== videoId) {
      this.videoId = videoId;
      this.state = STATE.UNSTARTED;
      p.loadVideoById({ videoId, startSeconds: from });
    } else {
      p.seekTo(from, true);
      p.playVideo();
    }
    // Ad signs while the video is "unstarted": the "ad" module loads (it stays loaded after an ad, so
    // only counts if it appears now), or the clock runs away from `from` (a stale reading doesn't run).
    const moduleBefore = this._hasAdModule();
    let signSince = null;   // when the signs began; they must last AD_CONFIRM_MS
    let signClock = null;   // the clock then
    let adSeen = false;     // an ad played during this load, so allow AD_WAIT_MS
    let adShown = false;    // onAd last reported an ad
    const report = (time) => { adShown = time != null; if (onAd) onAd(time); };
    try {
      // Playing near `from` means the content itself (not an ad) is buffered there.
      await this._poll(() => {
        const t = this.time();
        if (this.state === STATE.PLAYING && Math.abs(t - from) < 4) return true;
        const unstarted = this.state === STATE.UNSTARTED && this.duration() > 0;
        const away = unstarted && Math.abs(t - from) > 1.5;
        const module = unstarted && !moduleBefore && this._hasAdModule();
        if (!away && !module) {
          signSince = null;
          if (adShown) report(null);
          return false;
        }
        if (signSince == null) { signSince = performance.now(); signClock = t; }
        if (performance.now() - signSince < AD_CONFIRM_MS || !(adSeen || module || t !== signClock)) return false;
        if (skipAds) throw new AdError();
        adSeen = true;
        report(away ? t : 0);   // during an ad the player's clock runs through the ad
        return false;
      }, () => (adSeen ? AD_WAIT_MS : LOAD_MS), op, 'loading video');
      try { p.setPlaybackQuality(this.quality); } catch { /* optional API */ }
    } catch (err) {
      if (err instanceof AdError) { try { p.stopVideo(); } catch { /* player gone */ } }
      if (err instanceof PlayerError || err instanceof TimeoutError || err instanceof AdError) this.videoId = null;
      throw err;
    } finally {
      if (adShown) report(null);   // before pausing, which brings up YouTube's title and suggestions
    }
    p.pauseVideo();
    p.seekTo(from, true);
    await this._poll(() => this.state === STATE.PAUSED && Math.abs(this.time() - from) < 0.35, 4000, op, 'seeking')
      .catch((err) => { if (err instanceof CancelledError || err instanceof PlayerError) throw err; });
  }

  /**
   * Play `seconds` of the video from `start` (the player should be prepared). The sound is
   * driven by the video's position: silent until `start`, faded out at `start + seconds`.
   * onStart() fires when the sound opens; onProgress(fraction 0..1) while playing.
   */
  async playClip(start, seconds, { volume = 80, onProgress, onStart } = {}) {
    await this.init();
    const op = ++this.op;
    this.errorCode = null;
    const p = this.player;
    const from = Math.max(0, start - PREROLL);
    const end = start + seconds;
    const here = this.time();
    if (this.state === STATE.ENDED || here < from - 0.05 || here > start - OPEN_EARLY) p.seekTo(from, true);
    // unMute first: YouTube bumps a volume of 0 to 5 when unmuting, which made the pre-roll faintly audible
    p.unMute();
    p.setVolume(0);
    p.playVideo();
    try {
      // Wait until it really plays from the pre-roll point (a seek can land a moment late).
      await this._poll(() => this.state === STATE.PLAYING && this.time() >= from - 0.3 && this.time() < start + 1, 8000, op, 'starting playback');
    } catch (err) {
      if (err instanceof TimeoutError) {
        p.pauseVideo();
        throw new AutoplayBlockedError();
      }
      throw err;
    }

    let open = false;
    let lastVol = 0;
    let lastPos = -1;
    let lastMove = performance.now();
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (op !== this.op) return reject(new CancelledError());
        if (this.errorCode != null) { const c = this.errorCode; this.errorCode = null; return reject(new PlayerError(c)); }
        const pos = this.time();
        const now = performance.now();
        if (pos !== lastPos) { lastPos = pos; lastMove = now; }
        else if (now - lastMove > STALL_MS) return reject(new TimeoutError('playback stalled'));
        if (!open && pos >= start - OPEN_EARLY) {
          open = true;
          p.setVolume(volume);
          lastVol = volume;
          if (onStart) onStart();
        }
        const left = end - STOP_EARLY - pos;
        if (open) {
          if (onProgress) onProgress(Math.min(1, Math.max(0, (pos - start) / seconds)));
          if (left > 0 && left <= FADE_OUT) {
            const v = Math.round(volume * (left / FADE_OUT));
            if (Math.abs(v - lastVol) >= 2) { p.setVolume(v); lastVol = v; }
          }
        }
        if (left <= 0 || this.state === STATE.ENDED) {
          p.pauseVideo();
          setTimeout(() => { if (op === this.op) p.setVolume(volume); }, 150);
          if (onProgress) onProgress(1);
          return resolve();
        }
        setTimeout(tick, CLIP_TICK_MS);
      };
      tick();
    });
  }

  /** Continue playing from wherever the player is (used after answering). */
  resume(volume = 80) {
    if (!this.player) return;
    ++this.op;
    this.player.setVolume(volume);
    this.player.unMute();
    this.player.playVideo();
  }

  /** Stop whatever is going on; fades out briefly if audio is playing. */
  async stop(fadeMs = 250, volume = 80) {
    if (!this.player) return;
    const op = ++this.op;
    if (this.isPlaying() && fadeMs > 0) {
      const steps = 6;
      for (let i = steps - 1; i >= 0; i--) {
        if (op !== this.op) return;
        this.player.setVolume(Math.round((volume * i) / steps));
        await sleep(fadeMs / steps);
      }
    }
    if (op !== this.op) return;
    try {
      this.player.pauseVideo();
      this.player.setVolume(volume);
    } catch { /* player gone */ }
  }

  /* --- plain controls for the editor (no-ops until the player is ready) --- */
  cue(videoId, start = 0) {
    if (!this.player) return;
    ++this.op;
    this.videoId = videoId;
    this.player.cueVideoById({ videoId, startSeconds: start });
  }
  play() { if (!this.player) return; ++this.op; this.player.unMute(); this.player.playVideo(); }
  pause() { if (!this.player) return; ++this.op; this.player.pauseVideo(); }
  seek(t) { if (this.player) this.player.seekTo(Math.max(0, t), true); }
  setVolume(v) { if (this.player) this.player.setVolume(v); }
  setRate(r) { if (this.player) this.player.setPlaybackRate(r); }
}

export { STATE };
