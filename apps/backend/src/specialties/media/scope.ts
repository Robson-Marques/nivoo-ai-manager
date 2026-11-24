import { hasMotionCommand } from '../../jobs/motion/command';

/** The configured area, not words in an unrelated task, selects its domain.
 * General/legacy areas retain their historical broad capability set.
 */
export interface AreaScope { template?: string | null; slug?: string | null }
const MEDIA_TEMPLATES = new Set(['design-video','video','video-veo','imagem']);
const GENERAL_TEMPLATES = new Set(['geral','generica']);
export function mediaEnabledForArea(area?: AreaScope | null): boolean {
  if (!area) return true; // legacy callers, e.g. validating imported plans
  const template=area.template || area.slug || 'generica';
  return MEDIA_TEMPLATES.has(template) || GENERAL_TEMPLATES.has(template);
}

/** Existing plans can explicitly invoke a native media operation even outside
 * a media area. Mere mentions of a command or a video are not operations.
 */
export function hasNativeMediaOperation(steps: unknown, defaultProvider: string): boolean {
  if(!Array.isArray(steps))return false;
  return steps.some(step=>{
    if(!step||typeof step!=='object')return false;
    const provider=String(step.provider??defaultProvider);
    if(['gemini-video','gemini-image','juntar-videos','gerar-narracao','nvidia-media'].includes(provider))return true;
    if(provider!=='local-shell')return false;
    const command=String(step.instructions??'');
    return hasMotionCommand(command) || /(?:^|[;&|\n])\s*(?:env\s+)?(?:\/usr\/local\/bin\/)?nivoo-(?:conferir-arte|analisar-video|extrair-quadros)(?:\s|$)/m.test(command);
  });
}
