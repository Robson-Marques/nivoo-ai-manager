import { createHash } from 'node:crypto';
import { capabilityReference } from '../../../jobs/workflow/capability-criteria';
import { adoptionOf } from '../../../jobs/workflow/adoption-contract';
import { hasNativeMediaOperation,type AreaScope } from '../../media/scope';
import { softwareInterfaceEnabled } from '../../scope';
import { RULE_REVIEW_STEP } from '../../../jobs/rule-review';
import { tipoDe } from '../../../accounts/connections';

type Step={key:string;title:string;instructions:string;provider?:string|null;verifyCommand?:string|null;dependsOn?:readonly string[];status?:string;providerOptions?:unknown};
type Criterion={key:string;kind:string;description?:string;config:unknown;status?:string};
type Plan={objective:string;defaultProvider:string;steps:readonly Step[];criteria:readonly Criterion[]};
export type EgmRoute={route:'excluded'|'design'|'lite';recommendSpecReview:boolean;reasons:string[];targets:string[];coverage:'not-applicable'|'declared-targets'|'uncertain'};
const sourceExt=/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|sql|prisma|proto|vue|svelte|swift|cpp|h|c)$/i;
const testPath=/(?:^|\/)(?:tests?|__tests__|fixtures|docs)(?:\/|$)|(?:\.test|\.spec|_test)\.[^.]+$/i;
const aiTypes=new Set(['codex-cli','codex-api','claude-code-cli','claude-api','nvidia-api','openrouter-free-api','groq-free-api','gemini-api','gemini-cli']);
const normalized=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function declaredSourceTargets(text:string):string[]{
  const matches=text.matchAll(/(?:^|[\s\x60"'(])((?:[\w@.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs|rb|php|sql|prisma|proto|vue|svelte|swift|cpp|h|c))(?=$|[\s\x60"'():,;])/gim);
  return [...new Set([...matches].map(m=>m[1]).filter(p=>p.split('/').every(s=>s!=='.'&&s!=='..'&&!s.startsWith('.'))&&sourceExt.test(p)&&!testPath.test(p)))].sort();
}
export function routeEgm(plan:Plan,area:AreaScope|undefined):EgmRoute{
  const excluded=(reason:string):EgmRoute=>({route:'excluded',recommendSpecReview:false,reasons:[reason],targets:[],coverage:'not-applicable'});
  if(!softwareInterfaceEnabled(area))return excluded('área não destinada a software');
  const steps=plan.steps.filter(s=>s.key!==RULE_REVIEW_STEP);
  if(!steps.length||hasNativeMediaOperation(steps,plan.defaultProvider)||steps.some(s=>!aiTypes.has(tipoDe(s.provider??plan.defaultProvider)??'')))return excluded('operação de mídia, executor direto ou conexão não classificada');
  const text=[plan.objective,...steps.map(s=>s.instructions)].join('\n');
  const plain=normalized(text);
  const targets=declaredSourceTargets(text);
  const reasons:string[]=[];
  if(targets.length>=2)reasons.push('dois ou mais arquivos de produção declarados');
  if(/\b(?:async|await|concurren\w*|concorrenc\w*|deadlock|race condition|transac(?:ao|oes)|fila|worker|webhook)\b/.test(plain))reasons.push('rotina assíncrona, concorrente ou transacional mencionada');
  if(/\b(?:public api|api publica|endpoint|contrato externo|external contract|breaking change|schema migration|migracao de (?:banco|schema))\b/.test(plain))reasons.push('contrato de API ou dados mencionado');
  if(/\[(?:[^\]\r\n]*\s)?(?:UNVERIFIED|ACK)\]/i.test(text))reasons.push('premissa externa não verificada ou reconhecida');
  const design=plan.criteria.some(c=>!!adoptionOf(c.config)||['structural','acceptance'].includes(capabilityReference(c.config)?.phase??''));
  if(design)reasons.push('contrato estrutural de capacidade ou adoção');
  if(!targets.length)reasons.push('alvos de código não explicitados; risco não classificado como baixo');
  return {route:design?'design':'lite',recommendSpecReview:reasons.length>0,reasons,targets,coverage:targets.length?'declared-targets':'uncertain'};
}
export function renderEgmRoute(route:EgmRoute):string{
  if(route.route==='excluded')return '';
  return ['**Elephant — '+(route.route==='design'?'especificação estrutural':'checklist de execução leve')+'**',
    route.recommendSpecReview?'Revisão independente da especificação recomendada antes da implementação: '+route.reasons.join('; ')+'.':'Mudança com escopo declarado sem os indicadores de risco reconhecidos; execução direta razoável. Não é garantia de baixo risco.',
    'Fazer autoriza a implementação do plano apresentado. Não equivale a parecer Goldfish. A revisão independente da especificação ainda exige solicitação própria; nenhuma sessão adicional foi aberta.'].join('\n');
}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function executionChecklist(plan:Plan,route:EgmRoute,approval:{planMessageId:string;approvedAt:string},baseline:{commit:string|null;dirty:string[];complete:boolean}){
  return {version:1,approval,route,objective:plan.objective,baseline,scopeHash:digest({objective:plan.objective,steps:plan.steps.map(s=>({key:s.key,instructions:s.instructions,verifyCommand:s.verifyCommand??null,provider:s.provider??plan.defaultProvider,dependsOn:s.dependsOn??[]})),criteria:plan.criteria.map(c=>({key:c.key,kind:c.kind,config:c.config}))}),steps:plan.steps.map(s=>({key:s.key,title:s.title,instructions:s.instructions,verifyCommand:s.verifyCommand??null,status:s.status??'PENDENTE'})),criteria:plan.criteria.map(c=>({key:c.key,kind:c.kind,description:c.description??'',status:c.status??'PENDENTE'})),independentReview:'not-run' as const};
}
export function renderExecutionChecklist(c:ReturnType<typeof executionChecklist>):string{
  return ['# EGM Lite — checklist operacional do Nivoo','Aprovação do plano: '+c.approval.planMessageId+' / '+c.approval.approvedAt,'Escopo: '+c.scopeHash,'Base registrada: '+(c.baseline.commit??'indisponível')+'; inventário '+(c.baseline.complete?'capturado':'incompleto'),...c.baseline.dirty.map(s=>'- Estado anterior: '+JSON.stringify(s)),
    '## Objetivo',c.objective,'## Etapas aprovadas',...c.steps.flatMap(s=>['- ['+(s.status==='CONCLUIDO'?'x':' ')+'] '+s.key+' — '+s.title+' ('+s.status+')','  '+s.instructions,'  Verificação: '+(s.verifyCommand??'não indicada')]),
    '## Critérios',...c.criteria.map(x=>'- ['+x.status+'] '+x.key+' — '+x.description),'## Limites','O estado das etapas vem do backend, não de uma declaração da IA. Preserve alterações anteriores. Não altere alvos fora do plano; não enfraqueça testes. Não repita a suíte final apenas para antecipar o avaliador. Registre premissas não verificadas e escale mudanças de escopo. Parecer independente: não executado por este checklist.'].join('\n');
}
