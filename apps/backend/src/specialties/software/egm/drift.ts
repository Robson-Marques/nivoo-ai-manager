import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { resolutionSource } from './review-resolution';
import type { GoldfishReference,GoldfishDispatch,GoldfishReviewerRequest } from './review-pipeline';
import { validRelative,readReference } from './review-http';

const MAX_DOCS=10,MAX_SCAN_FILES=2000,MAX_SCAN_BYTES=16*1024*1024,MAX_REFS=24,MAX_CONTEXT=64*1024;
const sourceExt=/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|sql|prisma|proto|vue|svelte|swift|cpp|h|c|md)$/i;
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function driftRequest(text:string):string|null{
  const m=/^\/goldfish-drift(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m?(m[1]??'').trim():null;
}
export function parseDriftDirectory(scope:string):string{
  const dir=scope.startsWith('"')&&scope.endsWith('"')?scope.slice(1,-1):scope;
  if(!validRelative(dir))throw Error('Informe o diretório versionado de designs ou READMEs: /goldfish-drift docs/designs');
  return dir;
}
function safeDirectory(root:string,relative:string):string{
  let current=fs.realpathSync(root);
  for(const part of relative.split('/')){
    current=path.join(current,part);
    const stat=fs.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Diretório de design inválido ou simbólico.');
  }
  return current;
}
export type DriftDocument={target:GoldfishReference;references:GoldfishReference[];omitted:string[]};
export type DriftIntake={directory:string;documents:DriftDocument[];scanLimited:boolean;skipped:string[]};
function scan(root:string,dir:string,visit:(relative:string)=>boolean):boolean{
  const pending=[dir];
  while(pending.length){
    const d=pending.pop()!;
    for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const rel=d?d+'/'+e.name:e.name;
      if(!validRelative(rel)||e.isSymbolicLink())continue;
      if(e.isDirectory())pending.push(rel);
      else if(e.isFile()&&!visit(rel))return false;
    }
  }
  return true;
}
/** Bounded discovery. Explicit internal links precede exact path mentions and
 * symbol candidates. No external URL, private configuration or binary access. */
export function loadDriftIntake(root:string,scope:string):DriftIntake{
  const directory=parseDriftDirectory(scope);
  safeDirectory(root,directory);
  const targets:string[]=[];
  const finished=scan(root,directory,p=>{
    if(/\.md$/i.test(p))targets.push(p);
    return targets.length<=MAX_DOCS;
  });
  if(!finished)throw Error('Mais de '+MAX_DOCS+' documentos no diretório. Divida o escopo; nenhum documento será silenciosamente omitido.');
  if(!targets.length)throw Error('Nenhum documento Markdown localizado.');
  const skipped:string[]=[],source:GoldfishReference[]=[];
  let bytes=0,files=0;
  const scanned=scan(root,'',p=>{
    if(!sourceExt.test(p)||targets.includes(p))return true;
    if(++files>MAX_SCAN_FILES)return false;
    try{
      const r=readReference(root,p);const size=Buffer.byteLength(r.content);
      if(bytes+size>MAX_SCAN_BYTES)return false;
      bytes+=size;source.push(r);
    }catch{if(skipped.length<100)skipped.push(p);}
    return true;
  });
  const documents=targets.sort().map(p=>{
    const target=readReference(root,p),omitted:string[]=[],references:GoldfishReference[]=[];
    const seen=new Set([p]);let used=0;
    const admit=(ref:GoldfishReference)=>{
      if(seen.has(ref.path))return;
      seen.add(ref.path);
      const size=Buffer.byteLength(ref.content);
      if(references.length>=MAX_REFS||used+size>MAX_CONTEXT){omitted.push(ref.path);return;}
      used+=size;references.push(ref);
    };
    for(const m of target.content.matchAll(/!?\[[^\]\r\n]*\]\((?:<([^>\r\n]+)>|([^\s)\r\n]+))\)/g)){
      const link=(m[1]??m[2]).split('#')[0];
      if(!link)continue;
      try{
        if(/^[a-z][a-z0-9+.-]*:/i.test(link)||link.startsWith('/')||link.includes('\\'))throw Error('external');
        const rel=path.posix.normalize(path.posix.join(path.posix.dirname(p),decodeURIComponent(link)));
        if(!sourceExt.test(rel))throw Error('not source');
        admit(readReference(root,rel));
      }catch{omitted.push(link);}
    }
    // Backticked identifiers are hints, not an assertion of complete coverage.
    const symbols=[...new Set([...target.content.matchAll(/\x60([A-Za-z_$][\w$]{3,79})\x60/g)].map(m=>m[1]))].slice(0,80);
    const candidates=source.map(r=>({r,score:(target.content.includes(r.path)?100:0)+symbols.filter(s=>new RegExp('\\b'+s.replace(/[$]/g,'\\$&')+'\\b').test(r.content)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.r.path.localeCompare(b.r.path));
    for(const {r} of candidates)admit(r);
    return {target,references,omitted};
  });
  return {directory,documents,scanLimited:!scanned,skipped};
}
type Quote={path:string;line:number;quote:string};
type Difference={kind:'missing-feature'|'incomplete-model'|'logic-shortcut'|'architecture'|'undocumented-logic';description:string;design:Quote;code:Quote[]};
type DocResult={path:string;status:'partial'|'not-run';differences:Difference[];limitations:string[];raw?:string;sessionId?:string};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function verifiedQuote(v:unknown,refs:readonly GoldfishReference[]):v is Quote{
  if(!obj(v)||typeof v.path!=='string'||typeof v.line!=='number'||!Number.isInteger(v.line)||v.line<1||typeof v.quote!=='string'||!v.quote.trim()||v.quote.length>1000)return false;
  const file=refs.find(r=>r.path===v.path);
  return !!file&&!!file.content.split(/\r?\n/)[v.line-1]?.includes(v.quote);
}
export function parseDriftReport(raw:string,doc:DriftDocument):{differences:Difference[];limitations:string[]}|null{
  const matches=[...raw.matchAll(/^NIVOO_DRIFT_BEGIN\r?$\n([\s\S]*?)^NIVOO_DRIFT_END\r?$/gm)];
  if(matches.length!==1||matches[0][1].length>120000)return null;
  let parsed:unknown;try{parsed=JSON.parse(matches[0][1]);}catch{return null;}
  if(!obj(parsed)||!Array.isArray(parsed.differences)||parsed.differences.length>80||!Array.isArray(parsed.limitations)||parsed.limitations.some(x=>typeof x!=='string'||!x.trim()))return null;
  const differences:Difference[]=[];
  for(const d of parsed.differences){
    if(!obj(d)||!['missing-feature','incomplete-model','logic-shortcut','architecture','undocumented-logic'].includes(String(d.kind))||typeof d.description!=='string'||!d.description.trim()||!verifiedQuote(d.design,[doc.target])||!Array.isArray(d.code)||!d.code.length||!d.code.every(q=>verifiedQuote(q,doc.references)))return null;
    differences.push(d as unknown as Difference);
  }
  return {differences,limitations:parsed.limitations as string[]};
}
export async function runSemanticDrift(input:{intake:DriftIntake;revision:string;dispatch:GoldfishDispatch;signal:AbortSignal;onDocument?:(doc:DocResult)=>Promise<void>|void}){
  const results:DocResult[]=[],sessions=new Set<string>();
  for(const doc of input.intake.documents){
    if(input.signal.aborted)break;
    const limitations=[...doc.omitted.map(p=>'Referência não incluída: '+p),...(input.intake.scanLimited?['Busca de fontes limitada.']:[]),...(!doc.references.length?['Nenhuma fonte correspondente localizada.']:[])];
    let row:DocResult={path:doc.target.path,status:'not-run',differences:[],limitations};
    if(doc.references.length){
      const request:GoldfishReviewerRequest={stage:9,role:'egm-drift-'+digest(doc.target.path).slice(0,20),attempt:1,revision:input.revision,
        persona:[resolutionSource('skills/egm-drift-report/SKILL.md'),'Faça comparação semântica do documento contra as fontes autorizadas. Procure funcionalidades ausentes, modelos incompletos, atalhos de lógica, divergências arquiteturais e lógica não documentada. Não execute código. O escopo é uma seleção de candidatos, não o repositório integral. Informe limitações e sugira links para fontes ausentes. Acrescente um bloco NIVOO_DRIFT_BEGIN / NIVOO_DRIFT_END, um marcador por linha, com JSON {"differences":[{"kind":"missing-feature|incomplete-model|logic-shortcut|architecture|undocumented-logic","description":"divergência","design":{"path":"documento","line":1,"quote":"trecho exato"},"code":[{"path":"fonte","line":1,"quote":"trecho exato"}]}],"limitations":["limitação"]}. Cada trecho deve existir na linha indicada. Não fabrique evidência de ausência; cite a implementação relacionada e declare a limitação.'].join('\n'),
        target:{path:doc.target.path,ranges:[{start:1,end:doc.target.content.split(/\r?\n/).length,text:doc.target.content}]},
        baseline:doc.references,priorReports:[],access:'authorized-baseline',signal:input.signal};
      const r=await input.dispatch(request);
      if(r.status==='completed'&&r.receipt.sessionId&&r.receipt.freshContext&&r.receipt.readOnly&&r.receipt.access==='authorized-baseline'&&!sessions.has(r.receipt.sessionId)){
        sessions.add(r.receipt.sessionId);
        const parsed=parseDriftReport(r.report,doc);
        row={path:doc.target.path,status:parsed?'partial':'not-run',differences:parsed?.differences??[],limitations:[...limitations,...(parsed?.limitations??['Parecer sem evidência estruturada válida.']),'Cobertura restrita às fontes selecionadas; não certifica conformidade integral.'],raw:r.report,sessionId:r.receipt.sessionId};
      }else{
        row.limitations.push(r.status==='completed'?'Recibo de isolamento inválido ou repetido.':r.reason);
        results.push(row);await input.onDocument?.(row);break;
      }
    }
    results.push(row);await input.onDocument?.(row);
  }
  return {revision:input.revision,directory:input.intake.directory,results,pending:input.intake.documents.filter(d=>!results.some(r=>r.path===d.target.path)).map(d=>d.target.path),scanLimited:input.intake.scanLimited,skipped:input.intake.skipped};
}
export function renderSemanticDrift(report:Awaited<ReturnType<typeof runSemanticDrift>>):string{
  return ['# EGM Drift Report — comparação semântica limitada','Revisão '+report.revision+'; diretório '+report.directory,
    ...report.results.flatMap(r=>['','## '+r.path,...r.differences.map(d=>'- '+d.kind+': '+d.description+' (design '+d.design.path+':'+d.design.line+'; código '+d.code.map(q=>q.path+':'+q.line).join(', ')+')'),...(!r.differences.length?[r.status==='not-run'?'Análise não executada ou sem parecer válido.':'Nenhuma divergência apontada nas fontes avaliadas; não equivale a ausência de drift.']:[]),...r.limitations.map(l=>'- Limitação: '+l)]),
    ...report.pending.map(p=>'- Não analisado: '+p),...(report.skipped.length?['Fontes não lidas (lista limitada): '+report.skipped.join(', ')]:[])].join('\n');
}
