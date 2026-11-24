import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto, resolveInside, resolveMidiaOuTrabalho } from '../common/path-guard';

export interface VisualAsset { arquivo:string; transparente:boolean }
export function nativeImageTarget(raw:unknown):VisualAsset|undefined {
  if(raw===undefined||raw===null)return undefined;
  if(typeof raw!=='object'||Array.isArray(raw))throw new BadRequestException('visualAsset deve indicar um arquivo PNG.');
  const r=raw as Record<string,unknown>;
  const arquivo=caminhoDoProjeto(r.arquivo);
  if(!arquivo||! /^(?:motion|out)\/[A-Za-z0-9._/-]+\.png$/i.test(arquivo))
    throw new BadRequestException('visualAsset.arquivo deve ser um PNG novo em motion/ ou out/.');
  if(r.transparente!==undefined&&typeof r.transparente!=='boolean')throw new BadRequestException('visualAsset.transparente deve ser booleano.');
  return {arquivo,transparente:r.transparente===true};
}
export function visualReferences(raw:unknown):string[]{
  if(raw===undefined||raw===null)return [];
  if(!Array.isArray(raw)||raw.length>5)throw new BadRequestException('visualReferences aceita até cinco imagens locais.');
  return [...new Set(raw.map(r=>{
    const file=caminhoDoProjeto(r);
    if(!file||!/\.(png|jpe?g|webp)$/i.test(file))throw new BadRequestException('Referência visual inválida.');
    return file;
  }))];
}
export function isCodexAccount(id:string):boolean { return /^codex-cli(?:--[a-z0-9]+)?$/i.test(id); }
export function isCodex(id:string):boolean {return isCodexAccount(id)||/^codex-api(?:--[a-z0-9]+)?$/i.test(id);}
export function resolveVisualReferences(raw:unknown,cwd:string,mediaDir?:string):string[]{
  return visualReferences(raw).map(r=>{
    const f=resolveMidiaOuTrabalho(mediaDir,cwd,r);
    if(!fs.statSync(f).isFile())throw new Error('Referência visual não é arquivo: '+r);
    return f;
  });
}
export function prepareNativeImage(cwd:string,target:VisualAsset):void{
  const dest=resolveInside(cwd,target.arquivo);
  if(fs.existsSync(dest))throw new Error('Destino já existe; preserve a versão anterior e use um novo nome: '+target.arquivo);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
}
const MAX_BYTES=32*1024*1024;
function pngFile(file:string):boolean{
  try{
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.size<33||st.size>MAX_BYTES)return false;
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
      const b=Buffer.alloc(33);
      if(fs.readSync(fd,b,0,b.length,0)!==b.length)return false;
      return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
        b.toString('ascii',12,16)==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0&&
        b.readUInt32BE(16)*b.readUInt32BE(20)<=16_777_216;
    }finally{fs.closeSync(fd);}
  }catch{return false;}
}
/** Never search a shared account by timestamp or choose another thread's last image. */
export function nativeImageCandidates(home:string,cwd:string,thread:string|undefined,savedPaths:string[],startedAt:number):string[]{
  const found=new Set<string>();
  if(!thread||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread))return [];
  const add=(root:string,rel:string)=>{
    try{
      const f=resolveInside(root,rel);
      if(fs.realpathSync(f)!==f||!pngFile(f)||fs.statSync(f).mtimeMs<startedAt-2000)return;
      found.add(f);
    }catch{/* not a usable output */}
  };
  try{
    const dir=resolveInside(home,'generated_images/'+thread);
    if(fs.realpathSync(dir)===dir&&fs.lstatSync(dir).isDirectory()){
      for(const name of fs.readdirSync(dir).filter(n=>/^[A-Za-z0-9._-]+\.png$/i.test(n)).slice(0,100))
        add(dir,name);
    }
  }catch{/* earlier/newer CLI may use a workspace-local saved_path */}
  // Newer CLI can write directly under this worktree. Only paths from a
  // completed native image event are eligible, never paths from agent prose.
  for(const p of savedPaths){
    if(!path.isAbsolute(p))continue;
    const rel=path.relative(fs.realpathSync(cwd),p);
    if(/^generated_images\/[A-Za-z0-9._/-]+\.png$/i.test(rel)&&!rel.split('/').includes('..'))add(cwd,rel);
  }
  // Some CLI releases publish the same binary in the cache and worktree.
  const unique=new Map<string,string>();
  for(const file of found){
    try{const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(!unique.has(hash))unique.set(hash,file);}catch{/* disappeared */}
  }
  return [...unique.values()];
}
export function imageEventPath(ev:any):string|undefined{
  const item=ev?.item;
  if(ev?.type!=='item.completed'||!['image_generation','image_generation_call'].includes(item?.type)||
    item.status==='failed'||item.failure)return undefined;
  return typeof item.saved_path==='string'?item.saved_path:undefined;
}
const exec=promisify(execFile);
/** Decode exactly once with the already installed local FFmpeg. Verify actual
 * transparent and visible pixels, not a checkerboard painted into RGB. */
export async function inspectNativePng(file:string,transparent:boolean):Promise<void>{
  if(!pngFile(file))throw new Error('ImageGen não produziu um PNG válido dentro dos limites.');
  const args=['-v','error','-i',file,'-frames:v','1'];
  if(!transparent){
    await exec('ffmpeg',[...args,'-f','null','-'],{timeout:15000,maxBuffer:1024*1024});
    return;
  }
  const {stdout}=await exec('ffmpeg',[...args,'-vf','format=rgba,alphaextract','-f','rawvideo','-pix_fmt','gray','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:MAX_BYTES});
  if(!stdout.some(v=>v===0)||!stdout.some(v=>v>0))throw new Error('PNG sem recorte transparente real ou totalmente invisível.');
}
export async function recoverNativeImage(env:NodeJS.ProcessEnv,cwd:string,target:VisualAsset,thread:string|undefined,savedPaths:string[],startedAt:number):Promise<string>{
  const dest=resolveInside(cwd,target.arquivo);
  const home=env.CODEX_HOME??path.join(env.HOME??os.homedir(),'.codex');
  const candidates=nativeImageCandidates(home,cwd,thread,savedPaths,startedAt);
  // An explicit destination copied by the agent is accepted only if it
  // matches bytes from this thread (or the native event points there).
  if(fs.existsSync(dest)){
    if(!pngFile(dest))throw new Error('Destino não contém PNG válido.');
    const data=fs.readFileSync(dest);
    if(!candidates.some(p=>fs.readFileSync(p).equals(data)))throw new Error('PNG de destino não corresponde ao ImageGen desta sessão.');
    await inspectNativePng(dest,target.transparente);
    return target.arquivo;
  }
  if(candidates.length!==1)throw new Error(candidates.length?'ImageGen devolveu várias imagens sem seleção inequívoca.':'ImageGen não devolveu arquivo local desta sessão.');
  const source=candidates[0];
  await inspectNativePng(source,target.transparente);
  const tmp=dest+'.'+randomUUID()+'.tmp';
  try{
    fs.copyFileSync(source,tmp,fs.constants.COPYFILE_EXCL);
    fs.linkSync(tmp,dest);
  }finally{fs.rmSync(tmp,{force:true});}
  return target.arquivo;
}
