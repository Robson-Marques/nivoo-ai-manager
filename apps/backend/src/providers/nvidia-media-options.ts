import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../common/path-guard';
export const NVIDIA_OMNI='nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
export const NVIDIA_REASONER='nvidia/cosmos3-nano-reasoner';
export interface NvidiaMediaOptions {
  modo:'video'|'analise'; arquivo:string; conexao?:string; referencia?:string;
  modelo?:string; proporcao?:'9:16'|'16:9'; resolucao?:480|720; numFrames?:number; seed?:number;
}
export function nvidiaMediaOptions(key:string,o:any):NvidiaMediaOptions{
  const fail=(s:string):never=>{throw new BadRequestException('Etapa '+key+' NVIDIA: '+s);};
  o=o??{};
  if(o.modo!=='video'&&o.modo!=='analise')return fail('modo deve ser video ou analise');
  const arquivo=caminhoDoProjeto(o.arquivo);
  if(!arquivo||!(o.modo==='video'?/^midia\/saida\/[\w.-]+\.mp4$/i:/^out\/[\w/-]+\.md$/i).test(arquivo))return fail('destino incompatível com o modo');
  const out:NvidiaMediaOptions={modo:o.modo,arquivo};
  if(o.conexao!==undefined){
    if(typeof o.conexao!=='string'||!/^nvidia-api(?:--[0-9a-f]{8})?$/.test(o.conexao))return fail('conexão inválida');
    out.conexao=o.conexao;
  }
  if(o.referencia!==undefined){
    const r=caminhoDoProjeto(o.referencia);
    if(!r||r===arquivo||!(o.modo==='video'?/\.(png|jpe?g|webp)$/i:/\.(png|jpe?g|webp|mp4|wav|mp3)$/i).test(r))return fail('referência incompatível com o modo');
    out.referencia=r;
  }
  if(o.modo==='analise'){
    if(!out.referencia)return fail('análise exige referência');
    const m=o.modelo??NVIDIA_OMNI;
    if(m!==NVIDIA_OMNI&&m!==NVIDIA_REASONER)return fail('modelo de análise inválido');
    if(m===NVIDIA_REASONER&&/\.(wav|mp3)$/i.test(out.referencia))return fail('use Omni para áudio');
    return {...out,modelo:m};
  }
  const resolucao=o.resolucao??480,numFrames=o.numFrames??49,seed=o.seed??42;
  if(resolucao!==480&&resolucao!==720)return fail('resolução deve ser 480 ou 720');
  if(!Number.isInteger(numFrames)||numFrames<25||numFrames>(resolucao===720?197:297))return fail('número de quadros fora do limite');
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)return fail('seed inválida');
  if(o.proporcao!==undefined&&o.proporcao!=='9:16'&&o.proporcao!=='16:9')return fail('proporção inválida');
  return {...out,resolucao,numFrames,seed,proporcao:o.proporcao??'9:16'};
}
