import { aplicarPrioridadeDosExecutores,corrigirPlanoRenderizacaoMotion } from '../executor-priority';
import { dependenciasDeMontagemPorArquivo } from './media-dependencies';
import { BadRequestException } from '@nestjs/common';
import { motionFpsFromText,normalizeMotionFps } from '../motion/command';
import { applyReelsSafeArea } from '../motion/safe-area';
import { conectarMotorMotion } from '../motion-core-routing';
import { resolveWorkflowMediaPaths,normalizeWorkflowCriteria } from './media-paths';
import { comVideoCompleto } from './video-assembly';
import { AreaScope,mediaEnabledForArea,hasNativeMediaOperation } from '../../specialties/media/scope';

/** A single compilation boundary for the preview and the persisted job.
 * Transform the plan before validation; no new execution or AI sessions.
 */
export function compileWorkflowDefinition(raw:unknown,criteria:unknown,defaultProvider:string,objective:string,area?:AreaScope):{steps:unknown;criteria:unknown}{
  const media=mediaEnabledForArea(area);
  if(!media&&!hasNativeMediaOperation(raw,defaultProvider))return {steps:raw,criteria};
  const routed=media?corrigirPlanoRenderizacaoMotion(raw,defaultProvider,objective):raw;
  const withFps=Array.isArray(routed)?routed.map(s=>{
    if(!s||typeof s!=='object'||(s.provider??defaultProvider)!=='local-shell')return s;
    const preferred=motionFpsFromText(String(s.title??''))??motionFpsFromText(objective);
    const result=normalizeMotionFps(String(s.instructions??''),preferred);
    if(result.invalid)throw new BadRequestException('Etapa '+String(s.key)+': --fps deve indicar um único inteiro de 1 a 60.');
    return result.command===s.instructions?s:{...s,instructions:result.command};
  }):routed;
  const normalized=resolveWorkflowMediaPaths(withFps,defaultProvider);
  const prioritized=media?aplicarPrioridadeDosExecutores(normalized.steps,defaultProvider):normalized.steps;
  const assembled=comVideoCompleto(prioritized,defaultProvider);
  const linked=dependenciasDeMontagemPorArquivo(assembled,defaultProvider);
  return {steps:media?applyReelsSafeArea(dependenciasDeMontagemPorArquivo(conectarMotorMotion(linked,defaultProvider,objective),defaultProvider),defaultProvider,objective):linked,criteria:normalizeWorkflowCriteria(criteria,normalized.aliases)};
}
export function compileWorkflowPlan(raw:unknown,defaultProvider:string,objective:string,area?:AreaScope):unknown{
  return compileWorkflowDefinition(raw,undefined,defaultProvider,objective,area).steps;
}
