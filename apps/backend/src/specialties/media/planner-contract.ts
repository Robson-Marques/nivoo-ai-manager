import { VIDEO_QUALITY_POLICY } from '../../jobs/video-quality-policy';
import { motionPlannerRules } from './motion-planner';
import { audioPlannerRules } from './audio-planner';
import { assemblyPlannerRules } from './assembly-planner';
import { generationPlannerRules } from './generation-planner';
const { graphicsAuthorContract } = require('../../../bin/motion-graphics') as { graphicsAuthorContract: () => string };

/** A planner selects capabilities. The specialist/renderer owns authoring details. */
export function mediaPlannerRules():string[]{
  return [
    '## Capacidades locais de mídia',
    ...VIDEO_QUALITY_POLICY.map(line=>'- '+line),
    ...motionPlannerRules(),
    ...audioPlannerRules(),
    ...assemblyPlannerRules(),
  ];
}
export function mediaOptionalGenerationRules(videoDisponivel:boolean):string[]{
  return videoDisponivel?generationPlannerRules():[];
}
export function mediaAuthorRules():string[]{
  return ['## Acabamento audiovisual obrigatório (o estilo depende do briefing)',...VIDEO_QUALITY_POLICY.map(s=>'- '+s),graphicsAuthorContract()];
}
