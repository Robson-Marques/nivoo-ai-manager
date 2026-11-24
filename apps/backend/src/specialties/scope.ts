import { mediaEnabledForArea,type AreaScope } from './media/scope';

/** Shared domain selection: planner and executor must agree. */
export function softwareInterfaceEnabled(area?:AreaScope|null):boolean {
  const template=area?.template||area?.slug||'generica';
  return template==='geral'||template==='generica'||(!mediaEnabledForArea(area)&&template!=='atendimento');
}
