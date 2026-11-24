import { aplicarPrioridadeDosExecutores, corrigirPlanoRenderizacaoMotion, dependenciasDeMontagemPorArquivo } from '../executor-priority';
import { conectarMotorMotion } from '../motion-core-routing';
import { comVideoCompleto } from './video-assembly';

/**
 * Single application boundary for planning new jobs. The planner and the
 * persisted job use the very same ordered transformations. These are pure
 * domain transformations, not new job steps or AI calls.
 */
export function compileWorkflowPlan(raw: unknown, defaultProvider: string, objective: string): unknown {
  const routed=corrigirPlanoRenderizacaoMotion(raw,defaultProvider,objective);
  const prioritized=aplicarPrioridadeDosExecutores(routed,defaultProvider);
  const assembled=comVideoCompleto(prioritized,defaultProvider);
  const linked=dependenciasDeMontagemPorArquivo(assembled,defaultProvider);
  return conectarMotorMotion(linked,defaultProvider,objective);
}
