import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StudioComposition } from './studio-composition';

const Root: React.FC = () => (
  <Composition
    id="NivooStudio"
    component={StudioComposition}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{width:1080,height:1920,fps:30,durationInFrames:30,layers:[],compositionId:'NivooStudio',revision:'initial'}}
    calculateMetadata={({props}) => ({
      width:props.width,height:props.height,fps:props.fps,durationInFrames:props.durationInFrames,
    })}
  />
);
registerRoot(Root);
