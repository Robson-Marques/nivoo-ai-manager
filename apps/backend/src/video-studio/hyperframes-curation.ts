import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertWorkspacePath } from '../video/video-tool-adapters';
import type { HyperFramesCatalogItem } from './hyperframes-catalog';

export type HyperFramesCurationRequest={
  name:string;
  type:'block'|'component';
  title:string;
  description:string;
  tags:string[];
  requestedAt:string;
  source:'heygen-hyperframes-registry';
  state:'needs-review';
  executable:false;
};

/**
 * The project queue is a request for SOURCE REVIEW, never a software install.
 * State cannot be promoted through public API calls. Reviewed block imports
 * require a separate deployment and signed, pinned artifact.
 */
function queueDir(media:string):string {
  const root=fs.realpathSync(media);
  const studio=assertWorkspacePath(root,path.join(root,'studio'));
  if(fs.existsSync(studio)&&fs.lstatSync(studio).isSymbolicLink())
    throw new Error('Diretório Studio não confiável');
  fs.mkdirSync(studio,{recursive:true,mode:0o700});
  const queue=assertWorkspacePath(root,path.join(studio,'hyperframes-review'));
  if(fs.existsSync(queue)&&fs.lstatSync(queue).isSymbolicLink())
    throw new Error('Fila de curadoria não confiável');
  fs.mkdirSync(queue,{recursive:true,mode:0o700});
  if(fs.realpathSync(queue)!==queue)throw new Error('Fila de curadoria fora do projeto');
  return queue;
}
function safeName(name:string):boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(name);
}
function recordPath(dir:string,name:string):string {
  if(!safeName(name))throw new Error('Identificador de bloco inválido');
  return path.join(dir,name+'.json');
}
function readRecord(file:string):HyperFramesCurationRequest {
  if(fs.lstatSync(file).isSymbolicLink())throw new Error('Registro de revisão inválido');
  const size=fs.statSync(file).size;
  if(size>8_192||size<20)throw new Error('Registro de revisão fora do limite');
  const value=JSON.parse(fs.readFileSync(file,'utf8')) as HyperFramesCurationRequest;
  if(!value||!safeName(value.name)||!['block','component'].includes(value.type)||
    value.state!=='needs-review'||value.executable!==false||
    value.source!=='heygen-hyperframes-registry'||
    typeof value.title!=='string'||typeof value.requestedAt!=='string')
    throw new Error('Registro de curadoria corrompido');
  return value;
}
export function listHyperFramesReviewRequests(media:string):HyperFramesCurationRequest[]{
  const dir=queueDir(media);
  const filenames=fs.readdirSync(dir).filter(f=>/^[a-z0-9-]{1,80}\.json$/.test(f)).sort();
  if(filenames.length>120)throw new Error('Fila de revisão acima do limite');
  return filenames.map(f=>readRecord(path.join(dir,f)));
}
export function requestHyperFramesReview(media:string,item:HyperFramesCatalogItem):HyperFramesCurationRequest {
  if(!safeName(item.name)||!['block','component'].includes(item.type)||
    item.status!=='reference-only')throw new Error('Item externo inválido para curadoria');
  const dir=queueDir(media);
  const dest=recordPath(dir,item.name);
  if(fs.existsSync(dest))return readRecord(dest);
  const requests=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  if(requests.length>=120)throw new Error('Fila de curadoria cheia');
  const record:HyperFramesCurationRequest={
    name:item.name,type:item.type,title:item.title.slice(0,130),
    description:item.description.slice(0,350),
    tags:item.tags.slice(0,12),
    requestedAt:new Date().toISOString(),
    source:'heygen-hyperframes-registry',state:'needs-review',executable:false,
  };
  const temp=path.join(dir,'.'+randomUUID()+'.tmp');
  try {
    fs.writeFileSync(temp,JSON.stringify(record),{flag:'wx',mode:0o600});
    // O_EXCL prevents replacing a competing request, including a symlink.
    try {fs.linkSync(temp,dest);}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      return readRecord(dest);
    }
    return record;
  }finally{fs.rmSync(temp,{force:true});}
}
