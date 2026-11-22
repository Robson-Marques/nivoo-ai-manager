/** Strict, deterministic parser for Whisper-generated SubRip captions. */
export type SubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

function parseTimestamp(input: string): number {
  const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(input);
  if (!match) throw new Error('Invalid SRT timestamp');
  const [, hours, minutes, seconds, millis] = match;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) throw new Error('Invalid SRT timestamp');
  const value = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid SRT timestamp');
  return value;
}

export function parseWhisperSrt(srt: string, maxDurationMs = 3_600_000): SubtitleCue[] {
  if (typeof srt !== 'string' || srt.length > 2_000_000) throw new Error('Invalid SRT payload');
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new Error('Invalid SRT duration');
  const blocks = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
  if (blocks.length > 5000) throw new Error('Too many subtitle cues');
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3 || !/^[1-9]\d{0,8}$/.test(lines[0].trim())) throw new Error('Invalid SRT cue index');
    const match = /^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}[,.]\d{3})$/.exec(lines[1].trim());
    if (!match) throw new Error('Invalid SRT cue timing');
    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    const text = lines.slice(2).join('\n').trim();
    if (endMs <= startMs || endMs > maxDurationMs || !text || text.length > 5000 ||
        /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
      throw new Error('Invalid SRT cue content or duration');
    }
    if (cues.length && startMs < cues[cues.length - 1].startMs) throw new Error('Unordered SRT cues');
    cues.push({ id: 'subtitle-' + lines[0].trim(), startMs, endMs, text });
  }
  if (new Set(cues.map(cue => cue.id)).size !== cues.length) throw new Error('Duplicate SRT cue index');
  return cues;
}
