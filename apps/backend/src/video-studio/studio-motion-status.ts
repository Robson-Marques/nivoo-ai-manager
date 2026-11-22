import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateMotionRequest, type MotionPreset } from './hyperframes-motion';

export type StudioMotionState={
  state:'running'|'done'|'failed'|'cancelled';
  runId:string;
  started:string;
  preset:MotionPreset;
  title:string;
  fingerprint:string;
  error?:string;
  output?:string;
  durationMs?:number;
  warnings?:string[];
};

function location(media:string,id:string):string{
  if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('ID de edição inválido');
  return path.join(media,'studio',id+'.motion-status.json');
}
function validOutput(output:unknown,id:string):output is string{
  return typeof output==='string' &&
    new RegExp('^midia/saida/motion-'+id+'-[a-f0-9-]{36}\\.mp4$','i').test(output);
}
export function readStudioMotionState(media:string,id:string):StudioMotionState|undefined{
  const file=location(media,id);
  let raw:string;
  try{
    if(fs.lstatSync(file).isSymbolicLink())throw new Error('Estado de motion inválido (symlink)');
    raw=fs.readFileSync(file,'utf8');
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;
    throw error;
  }
  if(raw.length>16_384)throw new Error('Estado de motion acima do limite');
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new Error('Estado de motion corrompido');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Estado de motion inválido');
  const s=value as StudioMotionState;
  if(!['running','done','failed','cancelled'].includes(s.state)||
    typeof s.runId!=='string'||!/^[a-f\d-]{36}$/i.test(s.runId)||
    typeof s.started!=='string'||s.started.length>40||
    typeof s.fingerprint!=='string'||!/^[a-f0-9]{64}$/i.test(s.fingerprint)){
    throw new Error('Estado de motion não confiável');
  }
  validateMotionRequest({preset:s.preset,title:s.title});
  if(s.state==='running')return {...s,state:'failed',error:'Prévia interrompida pelo reinício do serviço. Você pode gerar novamente.'};
  if(s.state==='done'){
    if(!validOutput(s.output,id))throw new Error('Caminho do vídeo de motion inválido');
    const actual=path.join(media,s.output!.replace(/^midia\//,''));
    try{
      const meta=fs.lstatSync(actual);
      if(!meta.isFile()||meta.isSymbolicLink()||meta.size<1024)
        return {...s,state:'failed',error:'Arquivo da prévia ausente ou inválido'};
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')
        return {...s,state:'failed',error:'Arquivo da prévia foi removido'};
      throw error;
    }
  }
  return s;
}

export function saveStudioMotionState(media:string,id:string,state:StudioMotionState):void{
  const file=location(media,id);
  validateMotionRequest({preset:state.preset,title:state.title});
  if(!/^[a-f0-9]{64}$/i.test(state.fingerprint))throw new Error('Fingerprint de motion inválido');
  if(state.output && !validOutput(state.output,id))throw new Error('Saída de motion inválida');
  const folder=path.dirname(file);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,JSON.stringify(state),{flag:'wx',mode:0o600});
    fs.renameSync(tmp,file);
  }finally{fs.rmSync(tmp,{force:true});}
}
