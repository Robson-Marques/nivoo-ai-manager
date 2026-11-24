import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInside } from '../../common/path-guard';
import { readMotionInvocation,motionFpsFromText } from './command';

export function fpsOnlyResume(text:string):number|undefined{
  const plain=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!/\b(?:retome|retomar|continue|continuar|retomada)\b/.test(plain)||
     !/\b(?:somente|apenas|so)\b/.test(plain)||
     !/\b(?:renderizacao|renderizar|exportacao|exportar|fps)\b/.test(plain)||
     !/\b(?:preserve|preservar|reaproveite|reaproveitar|mantenha|manter)\b/.test(plain)||
     /\b(?:mude|adicione|remova|troque|recrie|refaca)\b/.test(plain))return undefined;
  return motionFpsFromText(text);
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validMotionResumeId(value:unknown):value is string{
  return typeof value==='string'&&UUID.test(value);
}

/** Accept a single literal invocation from a previously executed step.
 * Never copy arbitrary Bash or interpolate conversational text. */
export function resumeRenderCommand(old:string,jobId:string,fps:number,output:string):string|null{
  if(!validMotionResumeId(jobId)||!Number.isInteger(fps)||fps<1||fps>60||
     !/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/.test(output))return null;
  const words=old.trim().split(/\s+/);
  if(!['nivoo-renderizar-motion','/usr/local/bin/nivoo-renderizar-motion'].includes(words[0]))return null;
  const unquote=(s:string)=>s?.replace(/^(['"])(.*)\1$/,'$2');
  const source=unquote(words[1]);
  if(!/^motion\/[A-Za-z0-9._/-]+$/.test(source??'')||source.split('/').includes('..'))return null;
  const flags:Record<string,RegExp>={
    '--saida':/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/,
    '--segundos':/^\d+(?:\.\d+)?$/,
    '--tamanho':/^\d{2,5}x\d{2,5}$/,
    '--fps':/^\d+$/,
    '--motor':/^(auto|scene|hybrid|html)$/,
    '--ritmo':/^(normal|energetico)$/,
    '--duracao-origem':/^\d+(?:\.\d+)?$/,
    '--abertura-origem':/^\d+(?:\.\d+)?$/,
    '--abertura-final':/^\d+(?:\.\d+)?$/,
  };
  const values:Record<string,string>={};
  for(let i=2;i<words.length;i+=2){
    const name=words[i],value=unquote(words[i+1]);
    if(!Object.hasOwn(flags,name)||Object.hasOwn(values,name)||!value||!flags[name].test(value))return null;
    values[name]=value;
  }
  if(!values['--saida']||!values['--segundos']||!values['--tamanho']||values['--saida']===output)return null;
  const seconds=Number(values['--segundos']);
  if(!Number.isFinite(seconds)||seconds<1||seconds>300)return null;
  const [w,h]=values['--tamanho'].split('x').map(Number);
  if(!w||!h||w%2||h%2)return null;
  values['--saida']=output;values['--fps']=String(fps);
  const newSource='motion/retomada-'+jobId.slice(0,8)+'/'+source.slice(7);
  const command=['nivoo-renderizar-motion',newSource,...Object.entries(values).flat()].join(' ');
  return readMotionInvocation(command)?.fps===fps?command:null;
}

/** Copy the original source tree to a separate namespace in the new worktree.
 * No mutation of the previous job or its MP4. Reject incomplete trees, links,
 * or limits instead of silently using unrelated assets from main. */
export function restoreMotionResume(oldWorktree:string,newWorktree:string,jobId:string,command:string):void{
  if(!validMotionResumeId(jobId))throw new Error('Origem Motion inválida.');
  const source=readMotionInvocation(command)?.source??'';
  const prefix='motion/retomada-'+jobId.slice(0,8)+'/';
  if(!source.startsWith(prefix))throw new Error('A renderização não corresponde à origem Motion selecionada.');
  const from=resolveInside(oldWorktree,'motion');
  const oldSource=resolveInside(oldWorktree,'motion/'+source.slice(prefix.length));
  if(!fs.existsSync(oldSource))throw new Error('Fonte editável original não encontrada: '+source.slice(prefix.length));
  const to=resolveInside(newWorktree,prefix.slice(0,-1));
  const stage=to+'.tmp-'+process.pid;
  const files:Array<{src:string;rel:string}>=[];let bytes=0;
  function walk(dir:string,rel:string){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const next=path.join(dir,entry.name),name=path.join(rel,entry.name);
      if(entry.isSymbolicLink())throw new Error('Link simbólico na composição Motion original: '+name);
      if(entry.isDirectory()){
        if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;
        walk(next,name);
      }else if(entry.isFile()&&!entry.name.startsWith('.')){
        bytes+=fs.statSync(next).size;
        if(files.length>=3000||bytes>512*1024*1024)throw new Error('Fontes Motion excedem o limite de cópia segura.');
        files.push({src:next,rel:name});
      }
    }
  }
  if(!fs.lstatSync(from).isDirectory()||fs.lstatSync(from).isSymbolicLink())throw new Error('Origem Motion não é uma pasta regular.');
  walk(from,'');
  if(!files.length)throw new Error('Nenhum arquivo Motion disponível na origem.');
  // Retry: preserve the source snapshot when identical; do not overwrite.
  if(fs.existsSync(to)){
    for(const f of files){
      const dest=resolveInside(to,f.rel);
      if(!fs.existsSync(dest)||!fs.statSync(dest).isFile()||!fs.readFileSync(dest).equals(fs.readFileSync(f.src)))throw new Error('A cópia Motion existente diverge da origem; preserve ambas e escolha nova retomada.');
    }
    if(!fs.existsSync(resolveInside(newWorktree,source)))throw new Error('A cópia Motion não contém a entrada solicitada.');
    return;
  }
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.mkdirSync(stage,{recursive:false});
  try{
    for(const f of files){
      const dest=resolveInside(stage,f.rel);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.copyFileSync(f.src,dest,fs.constants.COPYFILE_EXCL);
    }
    if(!fs.existsSync(resolveInside(stage,source.slice(prefix.length))))throw new Error('Entrada Motion não recuperada.');
    fs.renameSync(stage,to);
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
