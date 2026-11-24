import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256 } from '../common/hash';
import { parseAgentNotes } from '../worker/executor/session-notes';

const MAX_WRITE=320_000,MAX_READ=1_000_000,MAX_RESULT=23_000;
const BLOCKED=/^(node_modules|\.git|\.env(?:\..*)?|\.claude|\.codex|\.gemini|segredos\.json|conexoes\.json|id_rsa|id_ed25519)$/i;
const INTERNAL=/^(?:contexto|\.nivoo)(?:\/|$)/;
const READ_ONLY=/^(?:contexto\/(?:skills-nivoo|base|conhecimento|repositorio|resultados|fontes-anteriores)(?:\/|$)|contexto\/(?:estado-etapa\.md|conversa-do-pedido\.md)|\.nivoo\/(?:memoria\.md|ultima-conferencia\.txt))$/;
function contextAllowed(rel:string):boolean{
  return rel==='contexto'||rel==='.nivoo'||READ_ONLY.test(rel)||/^contexto\/(?:skills-nivoo|base|conhecimento|repositorio|resultados|fontes-anteriores)\//.test(rel);
}
function safe(cwd:string,input:unknown,mode:'read'|'write'|'list'){
  const root=fs.realpathSync(cwd);
  if(typeof input!=='string'||!input.trim()||input.includes('\0'))throw Error('Informe o caminho relativo.');
  let rel=input.trim().replace(/\\/g,'/');
  if(path.isAbsolute(rel)){
    rel=path.relative(root,path.resolve(rel)).split(path.sep).join('/');
    if(!rel)rel='.';
  }
  if(rel==='.'&&mode==='list')return {root,rel,abs:root};
  const parts=rel.split('/');
  if(parts.some(p=>!p||p==='..'||p==='.'||BLOCKED.test(p)||/[\x00-\x1f]/.test(p)))throw Error('Caminho protegido ou inválido.');
  if(INTERNAL.test(rel)&&(mode==='write'||!contextAllowed(rel)))throw Error('Contexto do sistema somente para leitura autorizada.');
  if(parts.slice(1).some(p=>p==='.nivoo'||p==='contexto'))throw Error('Pasta interna protegida.');
  let abs=root;
  for(let i=0;i<parts.length;i++){
    abs=path.join(abs,parts[i]);
    try{
      const st=fs.lstatSync(abs);
      if(st.isSymbolicLink())throw Error('Links simbólicos não são permitidos nas ferramentas de texto.');
      if(i<parts.length-1&&!st.isDirectory())throw Error('Ancestral não é uma pasta.');
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  return {root,rel,abs};
}
function readText(abs:string,max=MAX_READ):{text:string;mode:number;hash:string}{
  const fd=fs.openSync(abs,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.size>max)throw Error('Arquivo não regular ou acima do limite de leitura.');
    const bytes=Buffer.alloc(st.size);
    let n=0;
    while(n<bytes.length){const r=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!r)break;n+=r;}
    const data=bytes.subarray(0,n),text=data.toString('utf8');
    if(n!==st.size||data.includes(0)||!Buffer.from(text,'utf8').equals(data))throw Error('Arquivo binário, não UTF-8 ou alterado durante a leitura.');
    return {text,mode:st.mode&0o777,hash:sha256(data)};
  }finally{fs.closeSync(fd);}
}
function atomicText(abs:string,text:string,mode=0o644){
  if(Buffer.byteLength(text)>MAX_WRITE||text.includes('\0'))throw Error('Conteúdo inválido ou acima de 320 KB.');
  const dir=path.dirname(abs);
  fs.mkdirSync(dir,{recursive:true});
  const tmp=fs.mkdtempSync(path.join(dir,'.nivoo-text-'));
  try{
    const f=path.join(tmp,'file');
    fs.writeFileSync(f,text,{flag:'wx',encoding:'utf8',mode});
    fs.chmodSync(f,mode);
    fs.renameSync(f,abs);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
function integer(value:unknown,def:number,max:number,min=0):number{
  if(value===undefined)return def;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Parâmetro numérico fora do limite.');
  return value;
}
function json(value:unknown):string{return JSON.stringify(value);}
export function executeFileTool(cwd:string,name:string,args:Record<string,unknown>):string{
  if(name==='registrar_progresso'){
    const parsed=parseAgentNotes(JSON.stringify(args));
    if(parsed.invalid||parsed.notes.length!==1)throw Error('Nota inválida: informe tipo, titulo e conteudo.');
    const n=parsed.notes[0];
    const dir=path.join(fs.realpathSync(cwd),'.nivoo');
    try{fs.mkdirSync(dir);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(!fs.lstatSync(dir).isDirectory())throw Error('Pasta de notas inválida.');
    const target=path.join(dir,'notas.jsonl');
    let previous='';
    try{previous=readText(target,8*1024*1024).text;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(parseAgentNotes(previous).notes.some(p=>p.canonicalHash===n.canonicalHash))return json({ok:true,alterado:false,aviso:'Nota já registrada.'});
    const line=json({tipo:n.tipo,titulo:n.titulo,conteudo:n.conteudo,arquivos:n.arquivos})+'\n';
    if(Buffer.byteLength(previous)+Buffer.byteLength(line)+1>8*1024*1024)throw Error('Diário de notas atingiu o limite; preservado.');
    const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
    try{if(!fs.fstatSync(fd).isFile())throw Error('Diário não regular.');fs.writeFileSync(fd,(previous&&!previous.endsWith('\n')?'\n':'')+line);}finally{fs.closeSync(fd);}
    return json({ok:true,alterado:true});
  }
  if(!['listar_arquivos','ler_arquivo','escrever_arquivo','substituir_texto'].includes(name))throw Error('Ferramenta não autorizada: '+name);
  const mode=name==='listar_arquivos'?'list':name==='ler_arquivo'?'read':'write';
  const p=safe(cwd,args.caminho??args.pasta??(mode==='list'?'.':undefined),mode);
  if(mode==='list'){
    if(!fs.lstatSync(p.abs).isDirectory())throw Error('Não é uma pasta.');
    const entries=fs.readdirSync(p.abs,{withFileTypes:true}).filter(e=>{
      if(e.isSymbolicLink()||BLOCKED.test(e.name)||(!e.isDirectory()&&!e.isFile()))return false;
      try{safe(cwd,(p.rel==='.'?'':p.rel+'/')+e.name,'list');return true;}catch{return false;}
    }).sort((a,b)=>a.name.localeCompare(b.name));
    const inicio=integer(args.inicio,0,Number.MAX_SAFE_INTEGER),limite=integer(args.limite,100,150,1);
    const arquivos:string[]=[];
    for(const e of entries.slice(inicio,inicio+limite)){
      const item=(p.rel==='.'?'':p.rel+'/')+e.name+(e.isDirectory()?'/':'');
      if(json([...arquivos,item]).length>MAX_RESULT-500)break;
      arquivos.push(item);
    }
    return json({arquivos,inicio,total:entries.length,proximo:inicio+arquivos.length,temMais:inicio+arquivos.length<entries.length});
  }
  if(mode==='read'){
    let source=p,aviso:string|undefined;
    if(!fs.existsSync(p.abs)&&/\.js$/i.test(p.rel)&&!INTERNAL.test(p.rel)){
      const alternative=safe(cwd,p.rel.replace(/\.js$/i,'.ts'),'read');
      if(fs.existsSync(alternative.abs)){source=alternative;aviso='Arquivo .js ausente; lido o .ts correspondente.';}
    }
    const {text,hash}=readText(source.abs);
    const inicio=Math.min(text.length,integer(args.inicio,0,Number.MAX_SAFE_INTEGER));
    let limite=integer(args.limite,18000,18000,1);
    while(true){
      const conteudo=text.slice(inicio,inicio+limite),proximo=inicio+conteudo.length;
      const result=json({caminho:source.rel,inicio,total:text.length,proximo,conteudo,temMais:proximo<text.length,sha256:hash,...(aviso?{aviso}:{})});
      if(result.length<=MAX_RESULT)return result;
      limite=Math.max(1,Math.floor(limite/2));
    }
  }
  let old:{text:string;mode:number;hash:string}|undefined;
  try{old=readText(p.abs,MAX_WRITE);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(args.sha256!==undefined&&(!old||args.sha256!==old.hash))throw Error('Arquivo mudou desde a leitura; leia novamente.');
  let text:string;
  if(name==='substituir_texto'){
    if(!old||typeof args.antes!=='string'||!args.antes||typeof args.depois!=='string')throw Error('Informe trecho original único e substituição.');
    const i=old.text.indexOf(args.antes);
    if(i<0||old.text.indexOf(args.antes,i+1)>=0)throw Error('Trecho ausente ou ambíguo; leia novamente e escolha texto único.');
    text=old.text.slice(0,i)+args.depois+old.text.slice(i+args.antes.length);
  }else{
    if(typeof args.conteudo!=='string')throw Error('Conteúdo inválido.');
    text=args.conteudo;
  }
  const changed=!old||old.text!==text;
  if(changed){safe(cwd,p.rel,'write');atomicText(p.abs,text,old?.mode);}
  return json({ok:true,alterado:changed,caminho:p.rel,caracteres:text.length,sha256:sha256(text)});
}
