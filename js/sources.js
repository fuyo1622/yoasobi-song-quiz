// Which video plays a song, and how its times map onto that video.
//
// Clips play from the audio-only upload (the "Topic" track, `videoId`), which all timings in
// data/songs.json are measured on. When it won't play and the song has an `mvMap`, the official
// MV (`mvId`) is used instead: each [start, end, offset] entry says that audio time t inside
// [start, end) is MV time t + offset (tools/align_mv.py measures these). MV clips are only taken
// from inside one mapped stretch, so they never cross an MV-only scene.
import { subtract } from './clips.js';

/** Offset for audio time t, or null when t is not covered by the map. */
export function offsetAt(map, t) {
  for (const [a, b, off] of map) if (t >= a && t < b) return off;
  return null;
}

/** The song as seen through the MV: parts with no MV counterpart become skip ranges. */
function throughMap(song, map) {
  const covered = map.map(([a, b]) => [a, b]);
  const gaps = subtract([[song.musicStart, song.musicEnd]], covered);
  // separate stretches touch each other; keep a clip from spanning two of them
  const seams = map.slice(1).map(([a]) => [a - 0.01, a + 0.01]);
  return { ...song, skip: [...(song.skip || []), ...gaps, ...seams].sort((x, y) => x[0] - y[0]) };
}

/**
 * Playback sources for a song, best first: the audio upload, then the MV (when mapped).
 * Each source: { kind: 'mv'|'audio', videoId, song (for picking clips), toVideo(t) }.
 */
export function sourcesFor(song) {
  const audio = { kind: 'audio', videoId: song.videoId, song, toVideo: (t) => t };
  const map = Array.isArray(song.mvMap) ? song.mvMap : [];
  if (!song.mvId || !map.length) return [audio];
  const mv = {
    kind: 'mv',
    videoId: song.mvId,
    song: throughMap(song, map),
    toVideo: (t) => {
      const off = offsetAt(map, t);
      return Math.round((t + (off ?? map[0][2])) * 100) / 100;
    },
  };
  return [audio, mv];
}

/** Audio-upload time for a time on the given source's video (for reports). */
export function toAudio(src, song, videoTime) {
  if (src.kind !== 'mv') return videoTime;
  for (const [a, b, off] of song.mvMap) {
    if (videoTime >= a + off && videoTime < b + off) return Math.round((videoTime - off) * 100) / 100;
  }
  return Math.round((videoTime - song.mvMap[0][2]) * 100) / 100;
}
