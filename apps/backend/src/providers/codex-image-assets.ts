import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
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
    const absolute=path.isAbsolute(p)?p:path.resolve(cwd,p);
    const rel=path.relative(fs.realpathSync(cwd),absolute);
    if(/^(?:generated_images|motion|out)\/[A-Za-z0-9._/-]+\.png$/i.test(rel)&&!rel.split('/').includes('..'))add(cwd,rel);
  }
  // Some CLI releases publish the same binary in the cache and worktree.
  const unique=new Map<string,string>();
  for(const file of found){
    try{const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(!unique.has(hash))unique.set(hash,file);}catch{/* disappeared */}
  }
  return [...unique.values()];
}
/** Decode both the legacy image tool and the extension event shipped by
 * newer Codex releases (event_msg.payload.item, kind=image_gen.generation).
 * Never treat assistant text, input images or command stdout as tool results. */
function nativeImageEvent(ev:any):Record<string,any>|undefined{
  const payload=ev?.type==='event_msg'?ev.payload:ev;
  const item=payload?.type==='item.completed'||payload?.type==='item_completed'?payload.item:
    ev?.type==='response_item'?ev.payload:ev?.type==='event_msg'?payload:undefined;
  if(!item||typeof item!=='object')return undefined;
  if(!['image_generation','image_generation_call','image_generation_end'].includes(item.type)&&
    !(['Extension','extension'].includes(item.type)&&item.kind==='image_gen.generation'))return undefined;
  return item;
}
function successfulImageEvent(ev:any):Record<string,any>|undefined{
  const item=nativeImageEvent(ev);
  if(!item||item.failure||['failed','cancelled','canceled','in_progress'].includes(item.status))return undefined;
  return item;
}
export function imageEventFailure(ev:any):string|undefined{
  const item=nativeImageEvent(ev);
  if(!item||!(item.failure||item.status==='failed'))return undefined;
  const failure=item.failure;
  // Only small, structured error fields; never dump the whole result.
  const kind=typeof failure==='object'&&failure?String(failure.type??failure.kind??''):'';
  const detail=typeof failure==='string'?failure:typeof failure?.message==='string'?failure.message:'';
  const limit=typeof failure?.limit_id==='string'?failure.limit_id:typeof failure?.limitId==='string'?failure.limitId:'';
  return ['ImageGen falhou',kind,limit,detail].filter(Boolean).join(': ').slice(0,500);
}
export function imageEventBytes(ev:any):Buffer|undefined{
  const item=successfulImageEvent(ev);
  if(!item)return undefined;
  const value=typeof item.result==='string'&&item.result?item.result:item.image?.result;
  if(typeof value!=='string'||value.length<44||value.length>Math.ceil(MAX_BYTES/3)*4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value))return undefined;
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<33||bytes.length>MAX_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    bytes.toString('ascii',12,16)!=='IHDR'||bytes.subarray(-8,-4).toString('ascii')!=='IEND')return undefined;
  return bytes;
}
/** Look only in the current account's dated session directory, for this
 * exact thread UUID. Some CLI releases keep PNG bytes only in rollout JSONL. */
export async function rolloutImageBytes(home:string,thread:string|undefined,startedAt:number,savedPaths:string[]=[]):Promise<Buffer[]>{
  if(!thread||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread))return [];
  const dates=new Set<string>();
  for(const t of [startedAt,Date.now()]){
    for(const d of [-1,0,1]){
      const date=new Date(t+d*86400000);
      dates.add(date.toISOString().slice(0,10).replace(/-/g,'/'));
    }
  }
  const found=new Map<string,Buffer>();
  for(const date of dates){
    let folder:string;
    try{folder=resolveInside(home,'sessions/'+date);if(fs.realpathSync(folder)!==folder)continue;}catch{continue;}
    let files:string[];
    try{files=fs.readdirSync(folder).filter(f=>f.startsWith('rollout-')&&f.endsWith('-'+thread+'.jsonl'));}catch{continue;}
    for(const name of files){
      let file:string;
      try{
        file=resolveInside(folder,name);
        const st=fs.lstatSync(file);
        if(!st.isFile()||st.size>160*1024*1024||st.mtimeMs<startedAt-2000)continue;
      }catch{continue;}
      let fd:number;
      try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch{continue;}
      const input=fs.createReadStream(file,{fd,autoClose:true});
      const lines=createInterface({input,crlfDelay:Infinity});
      let sessionMatches=false;
      try{
        for await(const line of lines){
          if(line.length>Math.ceil(MAX_BYTES/3)*4+1024*1024)continue;
          let ev:any;
          try{ev=JSON.parse(line);}catch{continue;}
          if(ev.type==='session_meta'){
            sessionMatches=ev.payload?.id===thread;
            if(!sessionMatches)break;
          }
          if(!sessionMatches)continue;
          const saved=imageEventPath(ev);
          if(saved&&!savedPaths.includes(saved)&&savedPaths.length<100)savedPaths.push(saved);
          const bytes=imageEventBytes(ev);
          if(bytes){
            const hash=createHash('sha256').update(bytes).digest('hex');
            if(!found.has(hash))found.set(hash,bytes);
            if(found.size>1)return [...found.values()];
          }
        }
      }catch{/* unavailable or incomplete rollout */}finally{lines.close();input.destroy();}
    }
  }
  return [...found.values()];
}
export function imageEventPath(ev:any):string|undefined{
  const item=successfulImageEvent(ev);
  const saved=item?.saved_path??item?.savedPath;
  return typeof saved==='string'?saved:undefined;
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
export async function recoverNativeImage(env:NodeJS.ProcessEnv,cwd:string,target:VisualAsset,thread:string|undefined,savedPaths:string[],startedAt:number,inline:Buffer[]=[]):Promise<string>{
  const dest=resolveInside(cwd,target.arquivo);
  const home=env.CODEX_HOME??path.join(env.HOME??os.homedir(),'.codex');
  const candidates=nativeImageCandidates(home,cwd,thread,savedPaths,startedAt);
  const blobs=new Map<string,Buffer>();
  const add=(bytes:Buffer)=>{blobs.set(createHash('sha256').update(bytes).digest('hex'),bytes);};
  for(const file of candidates)add(fs.readFileSync(file));
  for(const bytes of inline)add(bytes);
  // The on-disk output is preferred; consult rollout if the CLI did not save it.
  if(!blobs.size){
    const rolloutPaths:string[]=[];
    for(const bytes of await rolloutImageBytes(home,thread,startedAt,rolloutPaths))add(bytes);
    for(const file of nativeImageCandidates(home,cwd,thread,rolloutPaths,startedAt))add(fs.readFileSync(file));
  }
  const dataCandidates=[...blobs.values()];
  // An explicit destination copied by the agent is accepted only if it
  // matches bytes from this thread (or the native event points there).
  if(fs.existsSync(dest)){
    if(!pngFile(dest))throw new Error('Destino não contém PNG válido.');
    const data=fs.readFileSync(dest);
    if(!dataCandidates.some(p=>p.equals(data)))throw new Error('PNG de destino não corresponde ao ImageGen desta sessão.');
    await inspectNativePng(dest,target.transparente);
    return target.arquivo;
  }
  if(dataCandidates.length!==1)throw new Error(dataCandidates.length?'ImageGen devolveu várias imagens sem seleção inequívoca.':'ImageGen não devolveu PNG nem resultado recuperável no registro desta sessão.');
  const tmp=dest+'.'+randomUUID()+'.png';
  try{
    fs.writeFileSync(tmp,dataCandidates[0],{flag:'wx'});
    await inspectNativePng(tmp,target.transparente);
    fs.linkSync(tmp,dest);
  }finally{fs.rmSync(tmp,{force:true});}
  return target.arquivo;
}

/** A retry only reuses a file with the receipt for the same job, step,
 * provider and brief. An arbitrary preexisting PNG is not evidence. */
export function visualReceiptKey(jobId:string,stepId:string,providerId:string,brief:string,target:VisualAsset):string{
  return createHash('sha256').update(JSON.stringify([jobId,stepId,providerId,brief,target])).digest('hex');
}
function receiptFile(cwd:string,key:string):string{
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Identidade de ativo inválida.');
  return resolveInside(cwd,'.nivoo/visual-assets/'+key+'.json');
}
export function recordVisualReceipt(cwd:string,target:VisualAsset,key:string):void{
  const file=resolveInside(cwd,target.arquivo);
  const receipt=receiptFile(cwd,key);
  fs.mkdirSync(path.dirname(receipt),{recursive:true});
  const tmp=receipt+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,JSON.stringify({arquivo:target.arquivo,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}),{flag:'wx',mode:0o600});
    fs.renameSync(tmp,receipt);
  }finally{fs.rmSync(tmp,{force:true});}
}
export async function reuseVisualReceipt(cwd:string,target:VisualAsset,key:string):Promise<boolean>{
  const file=resolveInside(cwd,target.arquivo);
  if(!fs.existsSync(file))return false;
  let receipt:any;
  try{receipt=JSON.parse(fs.readFileSync(receiptFile(cwd,key),'utf8'));}catch{return false;}
  if(receipt.arquivo!==target.arquivo||!pngFile(file)||receipt.sha256!==createHash('sha256').update(fs.readFileSync(file)).digest('hex'))return false;
  await inspectNativePng(file,target.transparente);
  return true;
}
export function publishVisualPreview(cwd:string,outputDir:string,target:VisualAsset):void{
  if(target.arquivo.startsWith('out/'))return;
  fs.mkdirSync(outputDir,{recursive:true});
  const source=resolveInside(cwd,target.arquivo);
  const dest=resolveInside(outputDir,'visual-assets/'+target.arquivo);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(fs.existsSync(dest)){
    if(!fs.readFileSync(source).equals(fs.readFileSync(dest)))throw new Error('Conflito na prévia do ativo.');
    return;
  }
  fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL);
}
