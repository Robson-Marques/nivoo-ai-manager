/** Sincronização reutilizável de legendas cinéticas para prévia e exportação. */
export type TimedWord = { text: string; start: number; end: number };
export type TimedCaption = { text: string; start: number; end: number; words?: TimedWord[] };

export function validWords(c: TimedCaption): boolean {
  if (!Array.isArray(c.words) || !c.words.length || c.words.length > 80) return false;
  let previous = c.start;
  for (const word of c.words) {
    if (!word || typeof word.text !== 'string' || !word.text.trim() || word.text.length > 70 ||
        !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
        word.start < c.start - .05 || word.end > c.end + .05 ||
        word.start < previous - .03 || word.end <= word.start) return false;
    previous = word.end;
  }
  return true;
}

export function activeWord(c: TimedCaption, time: number): number {
  if (!validWords(c)) return -1;
  const words = c.words!;
  for (let i = 0; i < words.length; i++) {
    if (time >= words[i].start && time < words[i].end) return i;
  }
  return -1;
}

/** Extrai markup ASS karaoke determinístico, sem executar código do agente. */
export function karaokeAss(c: TimedCaption, escape: (s: string) => string): string | null {
  if (!validWords(c)) return null;
  let current = c.start;
  const parts: string[] = [];
  for (const word of c.words!) {
    const pause = Math.max(0, Math.round((word.start - current) * 100));
    if (pause > 0) parts.push('{\\k' + pause + '}');
    const duration = Math.max(1, Math.round((word.end - word.start) * 100));
    parts.push('{\\kf' + duration + '}' + escape(word.text) + ' ');
    current = word.end;
  }
  return parts.join('').trimEnd();
}
