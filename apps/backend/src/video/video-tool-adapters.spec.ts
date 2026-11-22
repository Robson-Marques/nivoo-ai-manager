import { assertWorkspacePath, validateMediaUrl, importAuthorizedVideo, transcribeWithWhisper } from './video-tool-adapters';

describe('video tool adapters boundaries', () => {
  it('allows paths inside workspace', () => {
    expect(assertWorkspacePath('/tmp/nivoo-project', '/tmp/nivoo-project/midia/saida'))
      .toBe('/tmp/nivoo-project/midia/saida');
  });

  it('blocks directory traversal', () => {
    expect(() => assertWorkspacePath('/tmp/nivoo-project', '/tmp/secret')).toThrow();
  });

  it('accepts allowlisted HTTPS media URLs', () => {
    expect(validateMediaUrl('https://www.youtube.com/watch?v=abc'))
      .toContain('youtube.com');
  });

  it.each([
    'http://youtube.com/watch?v=abc',
    'https://127.0.0.1/test',
    'https://localhost/test',
    'https://youtube.com:8443/test',
    'https://evil.example/test',
    'https://user:password@youtube.com/test',
  ])('rejects unsafe URL %s', url => {
    expect(() => validateMediaUrl(url)).toThrow();
  });
});

describe('optional video adapters', () => {
  it('fails closed for remote imports until egress isolation exists', async () => {
    await expect(importAuthorizedVideo(
      'https://youtube.com/watch?v=abc', '/tmp/nivoo-project', 'midia/entrada',
    )).rejects.toThrow('network egress isolation');
  });

  it('rejects missing transcription media before running Whisper', async () => {
    await expect(transcribeWithWhisper(
      '/tmp', '/tmp/nivoo-missing-transcription-media.mp4', '/tmp/nivoo-transcript',
    )).rejects.toThrow();
  });
});
