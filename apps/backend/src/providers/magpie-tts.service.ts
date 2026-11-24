import { ehAdicional, listarConexoes, tipoDe } from '../accounts/connections';
import { segredoDaConexao } from '../accounts/secrets';
import { aplicarPronuncias, KokoroTtsError, Pronuncias, TrechoDeLocucao, unirTrechosContinuos } from './kokoro-tts.service';
import { vozConhecida, VOZ_PADRAO_NVIDIA } from './vozes';

// Official hosted Magpie endpoint. Do not allow a user-supplied URL to receive credentials.
export const NVIDIA_TTS_BASE='https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio';

function credential(conexao?:string):string|undefined {
  if(conexao){
    if(tipoDe(conexao)!=='nvidia-api')throw new KokoroTtsError('Selecione uma conexão NVIDIA válida.');
    return segredoDaConexao(ehAdicional(conexao)?conexao:null,'NVIDIA_API_KEY');
  }
  const primary=segredoDaConexao(null,'NVIDIA_API_KEY');
  if(primary)return primary;
  const ids=listarConexoes().filter(c=>c.tipo==='nvidia-api'&&ehAdicional(c.id));
  if(ids.length===1)return segredoDaConexao(ids[0].id,'NVIDIA_API_KEY');
  if(ids.length>1)throw new KokoroTtsError('Há mais de uma conexão NVIDIA adicional; escolha a conexão da narração.');
  return undefined;
}

export function nvidiaTtsConfigurado():boolean{
  try{return !!credential()||listarConexoes().some(c=>c.tipo==='nvidia-api'&&!!credential(c.id));}
  catch{return listarConexoes().some(c=>c.tipo==='nvidia-api'&&!!credential(c.id));}
}

/** Continuous speech: respect written punctuation instead of automatically
 * turning every call to action into an exclamation. No Kokoro pause markers or
 * unsupported SSML; no invented controls for pitch, emotion or speed in pt-BR. */
export function roteiroFaladoNvidia(trechos:TrechoDeLocucao[]):string{
  return unirTrechosContinuos(trechos).map(t=>{
    const text=t.texto.trim();
    return t.intencao==='pergunta'&&!/[.!?…]$/.test(text)?text+'?':text;
  }).join(' ').replace(/\s+/g,' ').trim();
}

export function magpieForm(texto:string,voz:string):FormData{
  const canonical=vozConhecida(voz,'nvidia');
  if(!canonical)throw new KokoroTtsError('Voz NVIDIA pt-BR desconhecida: '+voz);
  if(!texto.trim()||texto.length>2000)throw new KokoroTtsError('Magpie aceita até 2.000 caracteres normalizados por locução. Reduza o roteiro, sem separar frases artificialmente.');
  if(/\[pause:|<\s*\/?\s*(?:speak|break|prosody|phoneme)\b/i.test(texto))
    throw new KokoroTtsError('Envie texto falado em português, sem marcadores Kokoro ou SSML.');
  const form=new FormData();
  form.set('text',texto.trim());
  form.set('language','pt-BR');
  form.set('voice',canonical.id);
  form.set('encoding','LINEAR_PCM');
  form.set('sample_rate_hz','44100');
  return form;
}

export function wavValido(bytes:Buffer):boolean{
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return false;
  let format=false;
  for(let i=12;i+8<=bytes.length;){
    const size=bytes.readUInt32LE(i+4);
    if(size>bytes.length-i-8)return false;
    const chunk=bytes.toString('ascii',i,i+4);
    if(chunk==='fmt '&&size>=16)format=bytes.readUInt16LE(i+8)===1&&bytes.readUInt32LE(i+12)>0;
    if(chunk==='data')return format&&size>0;
    i+=8+size+(size%2);
  }
  return false;
}

export async function gerarNarracaoNvidia(textoOriginal:string,voz=VOZ_PADRAO_NVIDIA,pronuncias:Pronuncias={},signal?:AbortSignal,conexao?:string,timeoutMs=180000):Promise<{bytes:Buffer;mime:string;modelo:string;textoSintetizado:string}>{
  const textoSintetizado=aplicarPronuncias(textoOriginal.trim(),pronuncias);
  const form=magpieForm(textoSintetizado,voz);
  const key=credential(conexao);
  if(!key)throw new KokoroTtsError('Cadastre uma chave NVIDIA em Conexões para usar Magpie.',true);
  let res:Response;
  try{
    res=await fetch(NVIDIA_TTS_BASE+'/synthesize',{
      method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,Accept:'audio/wav'},
      body:form,signal:AbortSignal.any([AbortSignal.timeout(Math.max(1000,Math.min(180000,timeoutMs))),...(signal?[signal]:[])])
    });
  }catch(e){
    throw new KokoroTtsError('NVIDIA Magpie: solicitação interrompida ou sem resposta. Confira a conexão antes de tentar novamente.',true);
  }
  if(!res.ok){
    const detail=(await res.text().catch(()=>'' )).split(key).join('[chave oculta]').replace(/nvapi-[A-Za-z0-9_-]+/g,'[chave oculta]').slice(0,350);
    throw new KokoroTtsError('NVIDIA Magpie HTTP '+res.status+(detail?': '+detail:''),[401,402,403,429].includes(res.status)||res.status>=500);
  }
  if(res.status!==200)throw new KokoroTtsError('NVIDIA Magpie retornou HTTP '+res.status+' sem áudio final; não há WAV confirmado.');
  const size=Number(res.headers.get('content-length')??0);
  if(size>32*1024*1024)throw new KokoroTtsError('NVIDIA devolveu áudio maior que 32 MiB.');
  const bytes=Buffer.from(await res.arrayBuffer());
  if(bytes.length>32*1024*1024||!wavValido(bytes))throw new KokoroTtsError('NVIDIA não devolveu WAV PCM válido.');
  return {bytes,mime:'audio/wav',modelo:'NVIDIA Magpie TTS Multilingual',textoSintetizado};
}
