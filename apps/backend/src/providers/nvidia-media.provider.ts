import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { listarConexoes,ehAdicional } from '../accounts/connections';
import { segredoDaConexao } from '../accounts/secrets';
import { resolveInside,resolveMidiaOuTrabalho } from '../common/path-guard';
import { minimalEnv,runProcess } from '../common/exec';
import { AiProvider,ExecutionRequest,ExecutionResult,ProviderStatus } from './provider.interface';
import { NvidiaSpecializedService } from './nvidia-specialized.service';
import { nvidiaMediaOptions } from './nvidia-media-options';
import { publishMediaFile } from './media-file-publication';

const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.wav':'audio/wav','.mp3':'audio/mpeg'};
function accounts():string[]{
  return [...new Set(['nvidia-api',...listarConexoes().filter(c=>c.tipo==='nvidia-api').map(c=>c.id)])].filter(id=>!!segredoDaConexao(ehAdicional(id)?id:null,'NVIDIA_API_KEY'));
}
function choose(requested?:string):string{
  const ids=accounts();
  if(requested){if(ids.includes(requested))return requested;throw new Error('Conexão NVIDIA sem chave cadastrada.');}
  if(ids.includes('nvidia-api'))return 'nvidia-api';
  if(ids.length===1)return ids[0];
  throw new Error(ids.length?'Escolha a conexão NVIDIA.':'Cadastre a chave NVIDIA em Conexões.');
}
@Injectable()
export class NvidiaMediaProvider implements AiProvider{
  readonly id='nvidia-media';
  readonly label='NVIDIA — geração e análise de mídia';
  readonly kind='executor' as const;
  constructor(private readonly nvidia:NvidiaSpecializedService){}
  async checkAvailability():Promise<ProviderStatus>{
    const configured=accounts().length>0;
    return {id:this.id,label:this.label,kind:this.kind,available:configured,installed:true,authenticated:configured,
      limits:{observacao:'Chave configurada não confirma acesso ao modelo; sujeito à cota e termos NVIDIA.'},
      capabilities:['cosmos-video','omni-analise','reasoner-analise'],errors:configured?[]:['Cadastre a conexão NVIDIA.'],checkedAt:new Date().toISOString(),isAi:false};
  }
  async execute(req:ExecutionRequest):Promise<ExecutionResult>{
    let tmp:string|undefined;
    const fail=(error:string):ExecutionResult=>({exitCode:1,output:'',error,interrupted:req.signal.aborted});
    try{
      if(req.signal.aborted)return fail('Interrompido');
      const o=nvidiaMediaOptions(req.stepId,req.options),account=choose(o.conexao);
      if(o.modo==='video'&&!req.projectMediaDir)return fail('Pasta de mídia do projeto não disponível.');
      const dest=resolveMidiaOuTrabalho(req.projectMediaDir,req.cwd,o.arquivo);
      if(fs.existsSync(dest))return fail('Destino existente; preserve o resultado anterior: '+o.arquivo);
      const prompt=req.instructions.trim();
      if(!prompt||prompt.length>(o.modo==='video'?2000:4000))return fail('Descrição vazia ou acima do limite.');
      let data:string|undefined;
      if(o.referencia){
        const src=resolveMidiaOuTrabalho(req.projectMediaDir,req.cwd,o.referencia);
        const stat=fs.statSync(src);
        if(!stat.isFile()||!stat.size||stat.size>8*1024*1024)return fail('Referência deve ser arquivo de até 8 MiB.');
        data='data:'+mime[path.extname(src).toLowerCase()]+';base64,'+fs.readFileSync(src).toString('base64');
      }
      if(o.modo==='analise'){
        req.onLog('NVIDIA: análise solicitada de '+o.referencia+' com '+o.modelo);
        const result=await this.nvidia.analisarMidia(account,o.modelo!,prompt,data!,req.signal);
        if(req.signal.aborted)return fail('Interrompido');
        tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-nvidia-'));
        const report=path.join(tmp,'analise.md');
        fs.writeFileSync(report,'# Análise NVIDIA\n\nModelo: '+o.modelo+'\nArquivo: '+o.referencia+'\n\n'+String(result.texto)+'\n');
        publishMediaFile(report,dest,true);
        return {exitCode:0,output:'Análise disponível em '+o.arquivo};
      }
      // A lost HTTP response may have generated media remotely. Never
      // automatically issue a second generation for the same step/output.
      const receipts=resolveInside(req.cwd,'.nivoo/nvidia-media');
      fs.mkdirSync(receipts,{recursive:true});
      const receipt=path.join(receipts,createHash('sha256').update(req.jobId+'\n'+req.stepId+'\n'+o.arquivo).digest('hex')+'.json');
      if(fs.existsSync(receipt))return fail('Solicitação Cosmos anterior já registrada. Confira o resultado remoto antes de reenviar.');
      fs.writeFileSync(receipt,JSON.stringify({estado:'enviando',arquivo:o.arquivo,em:new Date().toISOString()}),{flag:'wx'});
      req.onLog('NVIDIA Cosmos: '+(data?'imagem para vídeo':'texto para vídeo')+'; '+o.numFrames+' quadros.');
      const result=await this.nvidia.video(account,{prompt,proporcao:o.proporcao,resolucao:o.resolucao,numFrames:o.numFrames,seed:o.seed,inputReference:data},req.signal);
      if(req.signal.aborted)return fail('Interrompido após solicitação; não reenviar automaticamente.');
      tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-nvidia-'));
      const raw=path.join(tmp,'original.mp4'),final=path.join(tmp,'final.mp4');
      fs.writeFileSync(raw,Buffer.from(String(result.base64),'base64'));
      // Preserve the original result (provenance); transcode only a playback copy.
      const original=resolveInside(req.cwd,'out/nvidia-original/'+path.basename(o.arquivo));
      publishMediaFile(raw,original,true);
      const conv=await runProcess('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-i',raw,'-map','0:v:0','-map','0:a?','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','-crf','18','-c:a','aac','-movflags','+faststart',final],{cwd:tmp,env:minimalEnv(),signal:req.signal,timeoutMs:Math.min(180000,req.timeoutMs)});
      if(conv.exitCode!==0||req.signal.aborted||!fs.existsSync(final))return fail('Vídeo original preservado; conversão MP4 falhou: '+conv.stderr.slice(-350));
      publishMediaFile(final,dest,true);
      fs.writeFileSync(receipt,JSON.stringify({estado:'publicado',arquivo:o.arquivo}));
      return {exitCode:0,output:'Vídeo NVIDIA disponível em '+o.arquivo};
    }catch(e){return fail(String((e as Error)?.message??e).slice(0,900));}
    finally{if(tmp)fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
