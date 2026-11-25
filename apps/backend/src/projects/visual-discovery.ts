import { VISUAL_STYLES } from './visual-style-catalog';
import { FONT_PAIRINGS } from './visual-typography-catalog';
import { parseVisualProfileUpdate,type VisualProfileV1 } from './visual-profile';

export const VISUAL_DISCOVERY_KIND='perfil-visual';
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
const delegate=():Option=>({id:DELEGATE,rotulo:'IA escolhe',descricao:'Delegar esta preferência sem definir um valor agora.'});
function ordered(options:Option[],recommended:string):Option[]{
  return [...options].sort((a,b)=>Number(b.id===recommended)-Number(a.id===recommended)).map(o=>o.id===recommended?{...o,rotulo:o.rotulo+' (recomendado)'}:o);
}
export function visualDiscoveryQuestions(text:string,projectId:string,revision:number):Question[]{
  const t=normalize(text);
  const mobile=/\b(?:app|aplicativo|pwa|celular|mobile)\b/.test(t);
  const operational=/\b(?:erp|crm|gestao|gerenciamento|administracao|cadastro|dashboard|painel|sistema)\b/.test(t);
  const publicSite=/\b(?:site|website|landing page|loja virtual)\b/.test(t);
  const style=operational?'corporate':mobile?'liquid-glass':publicSite?'minimalist':'minimalist';
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
