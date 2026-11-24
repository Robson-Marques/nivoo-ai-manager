import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveInside, resolveMidiaOuTrabalho } from '../common/path-guard';
import { GeminiVideoProvider } from './gemini-video.provider';
import { imageOptions } from './image-options';
import type { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

const MODEL='gemini-nano-banana-2.1';
const MIME:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
export function validImagePng(bytes:Buffer):boolean {
  return bytes.length>32&&bytes.subarray(0,8).equals(PNG)&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.subarray(-8,-4).toString('ascii')==='IEND';
}
export function imageData(response:any):Buffer|null{
  const direct=response?.output_image;
  const blocks=Array.isArray(response?.steps)?response.steps.flatMap((s:any)=>Array.isArray(s?.content)?s.content:[]):[];
  const part=[direct,...blocks.slice().reverse()].find(p=>p&&(p.type==='image'||p===direct)&&typeof p.data==='string'&&p.mime_type!=='image/jpeg'&&p.mime_type!=='image/webp');
  if(!part||part.data.length>40*1024*1024)return null;
  const bytes=Buffer.from(part.data,'base64');
  return validImagePng(bytes)?bytes:null;
}

/** Native binary image production. No shell, no browser automation, no text-agent reconstruction. */
@Injectable()
export class GeminiImageProvider implements AiProvider {
  readonly id='gemini-image';
  readonly label='Imagem (Google: Nano Banana 2.1)';
  readonly kind='executor' as const;
  constructor(private readonly google:GeminiVideoProvider){}
  async checkAvailability():Promise<ProviderStatus>{
    const key=this.google.chave();
    return {id:this.id,label:this.label,kind:this.kind,available:!!key,installed:true,authenticated:!!key,
      limits:{observacao:'API paga; disponibilidade do modelo depende da chave Gemini.'},
      capabilities:['gerar-imagem'],errors:key?[]:['Configure uma conexão Gemini com chave de API.'],checkedAt:new Date().toISOString(),isAi:false};
  }
  async execute(req:ExecutionRequest):Promise<ExecutionResult>{
    const fail=(error:string):ExecutionResult=>({exitCode:1,output:'',error});
    let cost=0;
    try {
      if(req.signal.aborted)return {exitCode:1,output:'',interrupted:true};
      const opts=imageOptions(req.stepId,req.options??{});
      const credential=this.google.chave();
      if(!credential)return fail('Conexão Gemini sem chave de API.');
      const dest=resolveInside(req.cwd,opts.arquivo);
      if(fs.existsSync(dest))return fail('Destino de imagem já existe; use um novo nome para preservar a arte anterior.');
      const input:Array<Record<string,string>>=[{type:'text',text:req.instructions}];
      let total=0;
      for(const rel of opts.referencias){
        const file=resolveMidiaOuTrabalho(req.projectMediaDir,req.cwd,rel);
        const stat=fs.statSync(file);
        total+=stat.size;
        if(!stat.isFile()||total>15*1024*1024)return fail('Referências de imagem inválidas ou acima de 15 MiB no total.');
        input.push({type:'image',mime_type:MIME[path.extname(rel).toLowerCase()],data:fs.readFileSync(file).toString('base64')});
      }
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      req.onLog('Gerando ativo visual '+opts.arquivo+' com '+MODEL+' ('+opts.tamanho+', '+opts.proporcao+'); chamada paga.');
      const base=(process.env.NIVOO_GEMINI_API_BASE??'https://generativelanguage.googleapis.com').replace(/\/+$/,'');
      const res=await fetch(base+'/v1beta/interactions',{
        method:'POST',headers:{'x-goog-api-key':credential.chave,'Content-Type':'application/json','Api-Revision':'2026-05-20'},
        body:JSON.stringify({model:MODEL,input,response_format:{type:'image',mime_type:'image/png',aspect_ratio:opts.proporcao,image_size:opts.tamanho}}),
        signal:AbortSignal.any([req.signal,AbortSignal.timeout(Math.max(1,Math.min(req.timeoutMs,180_000)))]),
      });
      const json=await res.json().catch(()=>null);
      if(!res.ok)return fail('Gemini imagem HTTP '+res.status+': '+String(json?.error?.message??'sem detalhe').slice(0,500));
      // Estimativa apenas da saída de imagem. Entrada e raciocínio podem ter custo adicional.
      cost=opts.tamanho==='2K'?0.0504:0.0336;
      const bytes=imageData(json);
      if(!bytes)return {...fail('Gemini não devolveu PNG íntegro; estado: '+String(json?.status??'desconhecido')),costUsd:cost,costEstimated:true};
      const temp=dest+'.'+randomUUID()+'.tmp';
      try{
        fs.writeFileSync(temp,bytes,{flag:'wx'});
        fs.linkSync(temp,dest);
      }finally{fs.rmSync(temp,{force:true});}
      // Arquivo de produção fica no worktree; uma cópia é apresentada nos artefatos.
      if(path.resolve(req.outputDir,path.basename(dest))!==dest){
        try{fs.mkdirSync(req.outputDir,{recursive:true});fs.copyFileSync(dest,path.join(req.outputDir,path.basename(dest)),fs.constants.COPYFILE_EXCL);}
        catch(e){req.onLog('Imagem salva no projeto; cópia de apresentação indisponível.','WARN');}
      }
      return {exitCode:0,output:'Imagem pronta: '+opts.arquivo+' ('+bytes.length+' bytes)',costUsd:cost,costEstimated:true};
    }catch(e:any){
      if(req.signal.aborted)return {exitCode:1,output:'',interrupted:true,costUsd:cost,costEstimated:true};
      return {...fail('Geração de imagem não concluída: '+String(e?.message??e).slice(0,500)),costUsd:cost,costEstimated:true};
    }
  }
}
