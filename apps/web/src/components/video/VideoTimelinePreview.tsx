import { useMemo, useState } from 'react';

export type PreviewClip = {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  startMs: number;
  durationMs: number;
  zIndex: number;
  text?: string;
  /** Trusted same-origin media URL supplied by the server after authorization. */
  src?: string;
  animation?: 'none' | 'fade' | 'slide' | 'typewriter';
};

export type VideoTimelinePreviewProps = {
  width: number;
  height: number;
  durationMs: number;
  clips: PreviewClip[];
  onSeek?: (timeMs: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lightweight timeline inspector. Does not claim to replace a Remotion/HyperFrames
 * video preview; it exposes the same deterministic layer timing for review.
 */
export function VideoTimelinePreview({
  width, height, durationMs, clips, onSeek,
}: VideoTimelinePreviewProps) {
  const [timeMs, setTimeMs] = useState(0);
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1080;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1920;
  const active = useMemo(() => clips
    .filter(clip => clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)),
    [clips, timeMs]);

  const seek = (next: number) => {
    const value = clamp(next, 0, safeDuration);
    setTimeMs(value);
    onSeek?.(value);
  };

  return (
    <section aria-label="Prévia e linha do tempo" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{
        position: 'relative', aspectRatio: `${safeWidth} / ${safeHeight}`,
        maxHeight: 380, maxWidth: '100%', margin: 'auto', overflow: 'hidden',
        background: '#171923', borderRadius: 10, color: 'white',
      }} aria-label="Quadro da composição">
        {active.filter(c => c.kind !== 'audio').map(clip => {
          const elapsed = timeMs - clip.startMs;
          const enter = clamp(elapsed / 300, 0, 1);
          const animation = clip.animation ?? 'none';
          const opacity = animation === 'fade' ? enter : 1;
          const translateY = animation === 'slide' ? (1 - enter) * 40 : 0;
          const text = animation === 'typewriter'
            ? (clip.text ?? '').slice(0, Math.ceil((clip.text ?? '').length * clamp(elapsed / clip.durationMs, 0, 1)))
            : clip.text ?? clip.label;
          const style = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'contain' as const, opacity, transform: `translateY(${translateY}px)` };
          if (clip.kind === 'image' && clip.src) return <img key={clip.id} src={clip.src} alt={clip.label} style={style} />;
          if (clip.kind === 'video' && clip.src) return <video key={clip.id} src={clip.src} muted playsInline preload="metadata" style={style} />;
          return <div key={clip.id} style={{ ...style, display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box', textAlign: 'center' }}>{text}</div>;
        })}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Posição: {(timeMs / 1000).toFixed(2)}s / {(safeDuration / 1000).toFixed(2)}s</span>
        <input type="range" min={0} max={safeDuration} step={10} value={timeMs}
          onChange={event => seek(Number(event.target.value))} aria-label="Percorrer a linha do tempo" />
      </label>
      <div style={{ display: 'grid', gap: 4 }} aria-label="Camadas da linha do tempo">
        {clips.map(clip => {
          const left = clamp(clip.startMs / safeDuration * 100, 0, 100);
          const length = clamp(clip.durationMs / safeDuration * 100, 0, 100 - left);
          return <div key={clip.id} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={clip.label}>{clip.label}</span>
            <div style={{ position: 'relative', height: 20, background: 'rgba(127,127,127,.12)', borderRadius: 4 }}>
              <div title={clip.label} style={{ position: 'absolute', left: `${left}%`, width: `${length}%`, height: '100%', borderRadius: 4, background: 'rgba(100,140,220,.55)' }} />
            </div>
          </div>;
        })}
      </div>
    </section>
  );
}
