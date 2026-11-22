import { videoProbeParsers } from '../src/video/video-render-inspection';

describe('real video inspection parsers', () => {
  it('reads duration and audio presence from ffprobe output', () => {
    expect(videoProbeParsers.parseProbe(JSON.stringify({
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      format: { duration: '8.250' },
    }))).toEqual({ durationMs: 8250, hasAudio: true });
  });

  it('accepts long-form videos up to the Studio four-hour limit', () => {
    const probe=(seconds: string)=>JSON.stringify({
      streams:[{codec_type:'video'},{codec_type:'audio'}],
      format:{duration:seconds},
    });
    expect(videoProbeParsers.parseProbe(probe('7200')).durationMs).toBe(7_200_000);
    expect(videoProbeParsers.parseProbe(probe('14400')).durationMs).toBe(14_400_000);
    expect(()=>videoProbeParsers.parseProbe(probe('14401'))).toThrow('duration');
  });

  it('rejects malformed media probes and missing video streams', () => {
    expect(() => videoProbeParsers.parseProbe('not json')).toThrow('ffprobe');
    expect(() => videoProbeParsers.parseProbe(JSON.stringify({
      streams: [{ codec_type: 'audio' }], format: { duration: '10' },
    }))).toThrow('no video stream');
  });

  it('counts black-frame reports and parses peak volume', () => {
    expect(videoProbeParsers.parseBlackFrames(
      '[blackdetect] black_start:0 black_end:0.2\n[blackdetect] black_start:4 black_end:4.2',
    )).toBe(2);
    expect(videoProbeParsers.parseAudioPeak(
      '[Parsed_volumedetect] max_volume: -4.2 dB',
    )).toBe(-4.2);
    expect(() => videoProbeParsers.parseAudioPeak('no volume')).toThrow('missing');
  });
});
