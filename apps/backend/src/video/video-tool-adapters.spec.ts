import { assertWorkspacePath, validateMediaUrl } from './video-tool-adapters';

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
