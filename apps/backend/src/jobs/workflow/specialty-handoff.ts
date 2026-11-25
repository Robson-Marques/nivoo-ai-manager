import { readApprovedScope,type ApprovedScope } from '../approved-scope';

export const SPECIALTY_HANDOFF_KIND='retomada-especialidade';
export const SPECIALTY_HANDOFF_NOTICE='Especialidade criada e incorporada. O pedido original ainda não foi implementado.';

/** Identify the actual, incorporated change, not the AI's claim of completion.
 * Only an approved gap-creation job, not arbitrary documentation, triggers this. */
export function specialtyHandoff(value:unknown,projectId:string,files:ReadonlyArray<{status:string;path:string;de?:string}>):ApprovedScope|null{
  const scope=readApprovedScope(value,projectId);
  if(!scope||scope.areaTemplate!=='studio-workflow'||!scope.request)return null;
  const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!/especialidade\s+nao\s+catalogada/.test(normalize(scope.alignment)))return null;
  if(files.length!==2||files.some(f=>f.de||!['A','M'].includes(f.status)))return null;
  if(!files.some(f=>f.path==='docs/prompt-framework/catalogo-especialidades.md'))return null;
  if(!files.some(f=>f.status==='A'&&/^docs\/prompt-framework\/especialidades\/[\w-]+\.md$/.test(f.path)))return null;
  return scope;
}
