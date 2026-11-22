import { describeVideoToolCapabilities } from '../src/video/video-tool-capabilities';
import { StudioEditV1 } from '../src/video/video-studio-bridge';

describe('video tool capability declarations', () => {
  const edit: StudioEditV1 = {
    version: 1, id: 'test', updatedAt: 'r1', clips: [], captions: [], assets: [],
  };
  it('never advertises unavailable tools as ready', () => {
    const capabilities = describeVideoToolCapabilities(edit);
    expect(capabilities).toHaveLength(4);
    expect(capabilities.every(tool => tool.status !== 'available')).toBe(true);
    expect(capabilities.find(tool => tool.id === 'yt-dlp')?.status).toBe('blocked');
    expect(capabilities.find(tool => tool.id === 'whisper')?.status).toBe('blocked');
  });
  it('marks transcription experimental when clips exist', () => {
    const capabilities = describeVideoToolCapabilities({
      ...edit, clips: [{ id: 'clip', source: 'video.mp4', start: 0, end: 1, duration: 1 }],
    });
    expect(capabilities.find(tool => tool.id === 'whisper')?.status).toBe('experimental');
  });
});
