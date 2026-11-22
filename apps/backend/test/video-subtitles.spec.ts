import { parseWhisperSrt } from '../src/video/video-subtitles';

describe('Whisper SRT parsing', () => {
  it('converts timed captions to millisecond cues', () => {
    expect(parseWhisperSrt('1\n00:00:00,100 --> 00:00:01,400\nOlá, mundo!\n\n2\n00:00:01,500 --> 00:00:02,100\nSegunda linha'))
      .toEqual([
        { id: 'subtitle-1', startMs: 100, endMs: 1400, text: 'Olá, mundo!' },
        { id: 'subtitle-2', startMs: 1500, endMs: 2100, text: 'Segunda linha' },
      ]);
  });

  it('supports BOM, Windows line endings and multiline captions', () => {
    expect(parseWhisperSrt('\uFEFF1\r\n00:00:00.000 --> 00:00:00.900\r\nLinha 1\r\nLinha 2\r\n')[0].text)
      .toBe('Linha 1\nLinha 2');
  });

  it.each([
    '1\n00:00:02,000 --> 00:00:01,000\nReverso',
    '1\n00:00:00,000 --> 00:00:00,000\nZero',
    '1\n00:00:00,000 --> 00:00:02,000\nFora do limite',
    '1\n00:00:61,000 --> 00:00:62,000\nInválido',
    '1\n00:00:00,000 --> 00:00:00,500\nA\n\n1\n00:00:00,500 --> 00:00:00,900\nB',
  ])('rejects invalid subtitle blocks', srt => {
    expect(() => parseWhisperSrt(srt, 1000)).toThrow();
  });
});
