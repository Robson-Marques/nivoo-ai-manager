import { VISUAL_STYLES } from './visual-style-catalog';
import { FONT_PAIRINGS } from './visual-typography-catalog';
import { parseVisualProfileUpdate,type VisualProfileV1 } from './visual-profile';
import { softwareInterfaceEnabled } from '../specialties/scope';
import type { Prisma } from '@prisma/client';

export const VISUAL_DISCOVERY_KIND='perfil-visual';
export const VISUAL_BRIEFING_KIND='perfil-visual-briefing';
export const VISUAL_CONFIRMED_KIND='perfil-visual-confirmado';
export const VISUAL_DISCOVERY_TEXT='Antes do plano, escolha como deseja utilizar e visualizar o software. Você pode delegar cada decisão à IA ou responder livremente.';
const DELEGATE='delegated';
type Option={id:string;rotulo:string;descricao:string};
type Question={id:string;pergunta:string;opcoes:Option[];multipla:false;visualDiscovery:{version:1;projectId:string;revision:number}};
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const CREATE=/\b(?:criar|crie|desenvolver|desenvolva|construir|construa|fazer|faca|montar|monte|projetar|projete|implementar|implemente|quero|preciso de|gostaria de)\b/;
const PRODUCT=/\b(?:erp|crm|saas|sistema|software|aplicativo|app|pwa|site|website|landing page|loja virtual|dashboard|painel administrativo|portal|interface web)\b/;
const UI=/\b(?:erp|crm|saas|aplicativo|app|pwa|site|website|landing page|loja virtual|dashboard|painel administrativo|portal|interface web|cadastro|gestao|gerenciamento|administracao|clientes|telas?|frontend)\b/;
const EXCLUDED=/\b(?:corrigir|correcao|bug|ajustar|ajuste|alterar|refatorar|continuar|retomar|terminar|consertar|diagnosticar|migracao|migrar|endpoint|backend|api|biblioteca|cli|script|bot|webhook|video|reels|poster|audiovisual)\b/;
const DECIDED=/\b(?:liquid[- ]glass|(?:crystal|frosted|dark|prism)[- ]glass|vidro liquido|minimalista|corporativo|premium dark|glassmorphism|tema (?:claro|escuro)|fonte (?:inter|manrope|ibm)|identidade (?:existente|definida|visual da marca)|design existente|sem (?:perguntas|interface)|nao (?:pergunte|precisa perguntar)|(?:ia|voce) (?:escolhe|decide)|decida por mim|escolha por mim|delego)\b/;

export function visualDiscoveryIntent(text:string):boolean{
  const t=normalize(text);
  return CREATE.test(t)&&PRODUCT.test(t)&&UI.test(t)&&!EXCLUDED.test(t)&&!DECIDED.test(t)&&!/^\s*(?:como|qual|quais|o que|por que|sera que)\b/.test(t);
}

// Pedido explícito de dar nova cara a uma interface que já existe: redesenhar,
// trocar o template/tema/estilo, migrar para Liquid Glass, mudar a paleta. Exige
// um alvo visual real, então um ajuste comum de função ("corrigir cálculo",
// "mudar o endpoint") não dispara a seleção visual. Diferente de visualDiscoveryIntent,
// não exige que seja um produto novo: vale também para software existente.
const REDESIGN_PHRASE=/\b(?:(?:nova|outra) (?:cara|aparencia|identidade|interface|roupagem)|cara nova|(?:novo|outro) visual|visual novo|redesenh\w*|reestiliz\w*|repagin\w*|remodel\w*)\b/;
const REDESIGN_TARGET='visual|tema|template|estilo|layout|design|aparencia|identidade|interface|cara|cores|paleta|liquid[- ]glass|vidro liquido|glassmorphism';
const REDESIGN_VERB=new RegExp('\\b(?:troc\\w*|mud\\w*|alter\\w*|atualiz\\w*|renov\\w*|moderniz\\w*|migr\\w*|aplic\\w*|adot\\w*|convert\\w*|transform\\w*|pass\\w*|sair|ir|deix\\w*|coloc\\w*|refazer|refaz\\w*)\\b[^.?!]{0,40}\\b(?:'+REDESIGN_TARGET+')\\b');
const REDESIGN_PARA_LIQUID=/\b(?:para|pro|pra|ao|a)\s+(?:o\s+)?(?:liquid[- ]glass|vidro liquido)\b/;
const DAR_CARA=/\bdar\b[^.?!]{0,20}\bcara\b/;
export function visualRedesignIntent(text:string):boolean{
  const t=normalize(text);
  if(/^\s*(?:como|qual|quais|o que|por que|sera que)\b/.test(t))return false;
  return REDESIGN_PHRASE.test(t)||DAR_CARA.test(t)||REDESIGN_PARA_LIQUID.test(t)||REDESIGN_VERB.test(t);
}

/** Shared deterministic decision. A greeting or reference image is not a visual decision.
 * A clear restyle request ("nova cara", migrar para Liquid Glass) reopens the visual
 * selection even on an existing software, but an already answered round never re-asks. */
export function visualDiscoveryReason(input:{software:boolean;profile:unknown;gitUrl?:string|null;hasWork:boolean;answered:boolean;text:string}):'ask'|'other-domain'|'profile-defined'|'existing-repository'|'existing-work'|'answered'|'not-new-ui'{
  if(!input.software)return 'other-domain';
  const redesign=visualRedesignIntent(input.text);
  if(input.answered)return 'answered';
  if(input.profile!=null)return redesign?'ask':'profile-defined';
  if(input.gitUrl)return redesign?'ask':'existing-repository';
  if(input.hasWork)return redesign?'ask':'existing-work';
  return (redesign||visualDiscoveryIntent(input.text))?'ask':'not-new-ui';
}
type DiscoveryProject={id:string;area:{template?:string|null;slug?:string|null};visualProfile:unknown;gitUrl?:string|null};
type DiscoveryDb=Pick<Prisma.TransactionClient,'job'|'conversationMessage'>;
export async function visualDiscoveryForRequest(db:DiscoveryDb,project:DiscoveryProject,conversationId:string,text:string,at?:Date){
  const input={software:softwareInterfaceEnabled(project.area),profile:project.visualProfile,gitUrl:project.gitUrl,hasWork:false,answered:false,text};
  const initial=visualDiscoveryReason(input);
  if(initial!=='ask')return initial;
  const [work,briefing]=await Promise.all([
    db.job.findFirst({where:{projectId:project.id},select:{id:true}}),
    db.conversationMessage.findFirst({where:{conversationId,role:'USUARIO',kind:VISUAL_BRIEFING_KIND,...(at?{createdAt:{lte:at}}:{})},select:{id:true}}),
  ]);
  return visualDiscoveryReason({...input,hasWork:!!work,answered:!!briefing});
}
const delegate=():Option=>({id:DELEGATE,rotulo:'IA escolhe',descricao:'Delegar esta preferência sem definir um valor agora.'});
function ordered(options:Option[],recommended:string):Option[]{
  return [...options].sort((a,b)=>Number(b.id===recommended)-Number(a.id===recommended)).map(o=>o.id===recommended?{...o,rotulo:o.rotulo+' (recomendado)'}:o);
}
export function visualDiscoveryQuestions(text:string,projectId:string,revision:number):Question[]{
  const t=normalize(text);
  const mobile=/\b(?:app|aplicativo|pwa|celular|mobile)\b/.test(t);
  const operational=/\b(?:erp|crm|gestao|gerenciamento|administracao|cadastro|dashboard|painel|sistema)\b/.test(t);
  const publicSite=/\b(?:site|website|landing page|loja virtual)\b/.test(t);
  const glass=/\bliquid[- ]glass\b|\bvidro liquido\b|\bglassmorphism\b/.test(t);
  const style=glass?'liquid-glass':operational?'corporate':mobile?'liquid-glass':publicSite?'minimalist':'minimalist';
  const meta={version:1 as const,projectId,revision};
  const q=(id:string,pergunta:string,opcoes:Option[]):Question=>({id,pergunta,opcoes:[...opcoes,delegate()],multipla:false,visualDiscovery:meta});
  return [
    q('style','Qual identidade visual você prefere?',ordered(VISUAL_STYLES.map(s=>({id:s.id,rotulo:s.name,descricao:s.description})),style)),
    q('usage','Onde o software será mais utilizado?',ordered([
      {id:'desktop',rotulo:'Computador',descricao:'Prioridade para telas amplas e produtividade.'},
      {id:'mobile',rotulo:'Celular',descricao:'Prioridade para toque e telas pequenas.'},
      {id:'both',rotulo:'Ambos',descricao:'Interface responsiva para computador e celular.'},
    ],mobile?'mobile':'both')),
    q('typography','Qual combinação de fontes você prefere?',ordered(FONT_PAIRINGS.map(p=>({id:p.id,rotulo:p.name,descricao:p.description})),operational?'inter-ui':'native')),
    q('theme','Qual tema você prefere?',ordered([
      {id:'light',rotulo:'Claro',descricao:'Superfícies claras.'},
      {id:'dark',rotulo:'Escuro',descricao:'Superfícies escuras.'},
      {id:'system',rotulo:'Claro e escuro',descricao:'Respeitar a preferência do dispositivo.'},
    ],'system')),
  ];
}

/** Legacy question cards send exact displayed labels as text. Only a complete
 * unambiguous set of known choices may authorize a persisted profile. */
export function profileFromVisualAnswers(text:string,raw:unknown,projectId:string,revision:number):VisualProfileV1|null{
  if(!Array.isArray(raw)||raw.length!==4)return null;
  const qs=raw as Question[];
  const ids=['style','usage','typography','theme'];
  if(qs.some((q,i)=>q?.id!==ids[i]||q.visualDiscovery?.version!==1||q.visualDiscovery.projectId!==projectId||q.visualDiscovery.revision!==revision||!Array.isArray(q.opcoes)))return null;
  const chunks=text.trim().split('\n\n');
  if(chunks.length!==5||chunks[0]!=='Minhas respostas:')return null;
  const answers=qs.map((q,i)=>{
    const prefix=(i+1)+'. '+q.pergunta+'\n→ ';
    if(!chunks[i+1].startsWith(prefix))return undefined;
    const label=chunks[i+1].slice(prefix.length);
    return q.opcoes.find(o=>o.rotulo===label)?.id;
  });
  if(answers.some(v=>!v))return null;
  const [style,usage,typography,theme]=answers;
  const profile:Record<string,unknown>={schemaVersion:1,mode:answers.includes(DELEGATE)?'delegated':'guided'};
  if(style!==DELEGATE)profile.styleId=style;
  if(usage!==DELEGATE)profile.usage=usage;
  if(theme!==DELEGATE)profile.theme=theme;
  if(typography!==DELEGATE){
    const pairing=FONT_PAIRINGS.find(p=>p.id===typography);
    if(!pairing)return null;
    profile.fonts={...pairing.fonts};
  }
  try{return parseVisualProfileUpdate({expectedRevision:revision,profile}).profile;}catch{return null;}
}

/** The next visual selector may send a structured explicit decision including
 * palette/density. Bind to the latest server-issued question and revision. */
export function validateVisualSelection(value:unknown,projectId:string,revision:number,raw:unknown):VisualProfileV1{
  if(!Array.isArray(raw)||raw.length!==4||raw.some(q=>q?.visualDiscovery?.version!==1||q.visualDiscovery.projectId!==projectId||q.visualDiscovery.revision!==revision))throw Error('Perguntas visuais desatualizadas.');
  const result=parseVisualProfileUpdate({expectedRevision:revision,profile:value});
  if(!result.profile)throw Error('Escolha preferências ou delegue à IA.');
  return result.profile;
}
export function visualDecisionText(p:VisualProfileV1):string{
  return 'Confirmei as preferências visuais do projeto: '+JSON.stringify(p)+'. Continue o pedido original; apresente o plano para aprovação, sem repetir perguntas visuais já respondidas.';
}
