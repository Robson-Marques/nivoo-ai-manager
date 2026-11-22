import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StudioComposition } from './studio-composition';
import { Scene3D } from './three-scene';

const Root: React.FC = () => (
  <>
    <Composition
      id="NivooStudio"
      component={StudioComposition}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={30}
      defaultProps={{ width: 1080, height: 1920, fps: 30, durationInFrames: 30, layers: [], compositionId: 'NivooStudio', revision: 'initial' }}
      calculateMetadata={({ props }) => ({
        width: props.width, height: props.height, fps: props.fps, durationInFrames: props.durationInFrames,
      })}
    />
    <Composition
      id="Nivoo3D"
      component={Scene3D as any}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={60}
      defaultProps={{ width: 1080, height: 1920 }}
    />
  </>
);
registerRoot(Root);
