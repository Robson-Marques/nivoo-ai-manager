import React from 'react';
import { ThreeCanvas } from '@remotion/three';
import { useCurrentFrame, useVideoConfig } from 'remotion';

/** Cena 3D de verdade (WebGL via React Three Fiber): um cubo com iluminação girando — prova de render 3D por código,
 * sem IA generativa e sem custo por uso. É aqui que o motion design ganha profundidade real (volume, luz, câmera). */
export const Scene3D: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 6], fov: 50 }} style={{ background: '#140a0a' }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[6, 6, 6]} intensity={1.2} />
      <pointLight position={[-6, -3, 4]} intensity={0.5} color={'#ffcc66'} />
      <mesh rotation={[t * 0.9, t * 1.3, 0]}>
        <boxGeometry args={[2.2, 2.2, 2.2]} />
        <meshStandardMaterial color={'#c0392b'} metalness={0.4} roughness={0.25} />
      </mesh>
    </ThreeCanvas>
  );
};
