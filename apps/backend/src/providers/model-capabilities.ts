import { tipoDe } from '../accounts/connections';
import type { ProviderStatus } from './provider.interface';
import { modeloNvidiaServeComoAgente } from './nvidia-model-catalog';
import { modeloGroqDeTexto,modeloOpenRouterGratuito } from './free-cloud-api.provider';
import { NVIDIA_DEFAULT_MODEL } from './nvidia-api.provider';
import { isCodexAccount } from './codex-image-assets';

export type ModelAssessment={state:'eligible'|'unknown'|'incompatible';model:string|null;reason:string};
/** Resolve exactly the model that will be sent to this connection. A missing
 * override must not erase the project preference; never substitute a model. */
export function selectedModel(projectModel:string|undefined,options:unknown):string|undefined{
  const override=options&&typeof options==='object'&&!Array.isArray(options)?(options as Record<string,unknown>).model:undefined;
  if(override===undefined||override===null||override==='')return projectModel;
  if(typeof override!=='string'||override!==override.trim()||!override||/[\x00-\x1f\x7f]/.test(override))throw Error('Modelo da etapa inválido.');
  return override;
}
export function assessModel(providerId:string,configured:string|undefined,status:Pick<ProviderStatus,'kind'|'agentModels'|'capabilities'>,options?:unknown):ModelAssessment{
  const o=options&&typeof options==='object'&&!Array.isArray(options)?options as Record<string,unknown>:{};
  const type=tipoDe(providerId);
  const model=configured??(type==='nvidia-api'?(process.env.NIVOO_NVIDIA_MODEL??NVIDIA_DEFAULT_MODEL):type==='openrouter-free-api'?'openrouter/free':type==='groq-free-api'?'openai/gpt-oss-120b':type==='codex-cli'||type==='codex-api'?process.env.NIVOO_CODEX_MODEL:type==='claude-code-cli'||type==='claude-api'?process.env.NIVOO_CLAUDE_MODEL:type==='gemini-api'?process.env.NIVOO_GEMINI_MODEL:undefined)??null;
  const result=(state:ModelAssessment['state'],reason:string):ModelAssessment=>({state,model,reason});
  if(status.kind==='executor'||status.kind==='test')return result('unknown','executor específico; contrato próprio');
  if(o.visualAsset){
    if(!isCodexAccount(providerId))return result('incompatible','ImageGen nativo exige conexão Codex por conta');
    if(!status.capabilities.includes('imagegen-native-adapter'))return result('incompatible','CLI não anunciou adaptador ImageGen nativo');
    return result('unknown','adaptador de imagem anunciado; capacidade do modelo ainda não comprovada');
  }
  if(Array.isArray(o.images)&&o.images.length&&status.kind==='api')return result('incompatible','adaptador de texto HTTP não envia anexos de imagem ao modelo');
  if(model!==null&&type==='nvidia-api'&&!modeloNvidiaServeComoAgente(model))return result('incompatible','ID NVIDIA sem suporte documentado a chat e ferramentas locais no catálogo');
  if(model!==null&&type==='groq-free-api'&&!modeloGroqDeTexto(model))return result('incompatible','ID Groq fora do catálogo documentado de agentes locais');
  if(model!==null&&type==='openrouter-free-api'&&!modeloOpenRouterGratuito(model))return result('incompatible','rota não gratuita');
  if(type==='nvidia-api'||type==='groq-free-api'||type==='openrouter-free-api'){
    if(!Array.isArray(status.agentModels))return result('unknown','catálogo desta conexão não foi comprovado');
    if(model&&!status.agentModels.includes(model))return result('incompatible','modelo não consta entre os agentes elegíveis no catálogo atual da conexão');
    return result('eligible','ID e capacidade documental/catalogada compatíveis; não é teste de execução ou garantia de cota');
  }
  return result('unknown','CLI aceita seleção de modelo, mas não fornece evidência suficiente de capacidade específica; resultado real permanece necessário');
}
