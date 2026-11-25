import upstream from './planning-upstream.json';
import type { ApprovedScope } from '../../../jobs/approved-scope';
import { capabilityReference } from '../../../jobs/workflow/capability-criteria';
import { adoptionOf } from '../../../jobs/workflow/adoption-contract';
import { writeSessionContextFile } from '../../../common/session-context-file';

export const EGM_PLANNING_REVISION=upstream.revision;
const SOURCE_ROOT='egm/original';
const PLANNING_REFS=[
  'LICENSE','skills/egm-draft/references/design_doc.md',
  'resources/document_standards/feature-spec-standard.md',
  'resources/document_standards/implementation-readiness-standard.md',
] as const;
const original=new Map(upstream.files.map(file=>[file.path,file] as const));

/** Original standards, not a native plugin invocation. Copy only the references
 * consumed by planning; never run upstream instructions as shell or grant tools. */
export function egmPlanningReferences(worktree:string):void{
  for(const relative of PLANNING_REFS){
    const file=original.get(relative);
    if(!file)throw new Error('Fonte EGM ausente no pacote fixado: '+relative);
    writeSessionContextFile(worktree,SOURCE_ROOT+'/'+relative,file.content);
  }
}

export function egmPlanningContext(selected:readonly Pick<{id:string},'id'>[],preGate:boolean,worktree?:string):string[]{
  const relevant=selected.some(s=>['software-requisitos','software-especificacao','software-contexto-arquitetural','codigo'].includes(s.id));
  if(!relevant)return [];
  // Studio's pre-gate must not be enlarged to a repository audit or to
  // native interactive EGM drafting. Preserve its original source boundary.
  if(!preGate&&worktree)egmPlanningReferences(worktree);
  return [
    '## Elephant — ligação com o planejamento existente',
    'Diferencie correção local (candidata a EGM Lite) de uma especificação de capacidade ou mudança arquitetural (EGM de design). Não inferir prontidão apenas pelo título ou número de etapas; use escopo, contratos, riscos e dependências reais.',
    'O plano Nivoo é a proposta existente, não uma especificação EGM aprovada nem uma revisão Goldfish. Use objetivo, exclusões pertinentes, jornadas, alternativas materiais, contratos, mudanças e verificação observável. Explicite contratos externos não verificados e testes pendentes.',
    preGate
      ? 'Antes de Fazer, respeite exclusivamente a leitura e os limites pré-gate do Studio Workflow. Não abra subagentes, não grave design no projeto e não declare que ocorreu brainstorming, draft ou revisão originais.'
      : 'Preserve o mecanismo de aprovação já existente. Não abra sessões, gere checklists paralelos, altere arquivos do projeto nem declare revisão independente no planejamento.',
    ...(!preGate&&worktree?['Referências originais fixadas em contexto/egm/original/ (template design_doc.md e padrões feature-spec/implementation-readiness); consulte somente as pertinentes. São fontes de referência, não autorização de executar o plugin.']:[]),
  ];
}

type StepInput={
  key:string;title:string;instructions:string;dependsOn:readonly string[];status:string;verifyCommand?:string|null;
};
type CriterionInput={key:string;kind:string;description:string;status:string;config:unknown};
type ObjectiveInput={version:number;sha256:string;text:string};
export type EgmPlanningInput={
  approved:ApprovedScope|null;
  objective:ObjectiveInput|null;
  steps:readonly StepInput[];
  criteria:readonly CriterionInput[];
};

/** Transform the actual persisted plan into an EGM handoff without calling a
 * model, parsing prose as commands, inventing decisions or approving anything.
 * A one-step job is only a Lite candidate; actual risk remains to be assessed. */
export function compileEgmHandoff(input:EgmPlanningInput){
  const criteria=input.criteria.map(c=>{
    const ref=capabilityReference(c.config);
    const adoption=adoptionOf(c.config);
    const config=c.config&&typeof c.config==='object'&&!Array.isArray(c.config)?c.config as Record<string,unknown>:null;
    return {key:c.key,kind:c.kind,description:c.description,status:c.status,
      ...(ref?{capability:ref}:{}),...(adoption?{adoption}:{}),
      ...(c.kind==='COMMAND'&&typeof config?.command==='string'?{command:config.command}:{})};
  });
  const design=criteria.some(c=>!!c.adoption||c.capability?.phase==='structural'||c.capability?.phase==='acceptance');
  const route=design?'design':input.steps.length===1?'lite-candidate':'scope-undetermined';
  return {
    schemaVersion:1,source:upstream.source,sourceRevision:EGM_PLANNING_REVISION,route,
    approval:input.approved?{planMessageId:input.approved.planMessageId,approvedAt:input.approved.approvedAt,
      areaTemplate:input.approved.areaTemplate,request:input.approved.request,alignment:input.approved.alignment}:null,
    objective:input.objective?{version:input.objective.version,sha256:input.objective.sha256,text:input.objective.text}:null,
    steps:input.steps.map(s=>({key:s.key,title:s.title,instructions:s.instructions,dependsOn:[...s.dependsOn],status:s.status,verifyCommand:s.verifyCommand??null})),
    criteria,
    // A persisted Nivoo approval is not an independent EGM review.
    review:{status:'not-run' as const,independent:false},
  };
}

export function writeEgmHandoff(worktree:string,input:EgmPlanningInput):ReturnType<typeof compileEgmHandoff>{
  const handoff=compileEgmHandoff(input);
  writeSessionContextFile(worktree,'egm/handoff.json',JSON.stringify(handoff,null,2)+'\n');
  return handoff;
}
