import type { AreaScope } from './scope';

/** Known factual drift in the shipped default profile. Never mutate the
 * user's stored rules or reinterpret an independently written restriction.
 */
export const LEGACY_3D_PROFILE_LINE = "- Uma animação 3D COMPLETA é uma modalidade futura distinta; não confunda CSS 2.5D com objetos geométricos 3D. Não prometa renderização 3D completa usando só o renderizador atual.";
export const CURRENT_3D_PROFILE_LINE = "- O motor NivooGraphics possui malhas geométricas, câmera, materiais e iluminação com backends WebGL/software. Para 3D use seu contrato instalado; não confunda CSS 2.5D com geometria 3D real. Não prometa recursos que o motor não oferece.";
export function currentMediaBaseRules(area:AreaScope, rules:string):string {
  if((area.template||area.slug)!=='design-video')return rules;
  return rules.split('\n').map(line=>line.trim()===LEGACY_3D_PROFILE_LINE?CURRENT_3D_PROFILE_LINE:line).join('\n');
}
