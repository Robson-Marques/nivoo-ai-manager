import { tipoDe } from '../accounts/connections';
import { assessModel,selectedModel } from './model-capabilities';
import { projectModel } from './project-model';
import { nativeImageTarget,isCodex } from './codex-image-assets';
import { supportsProjectMcp } from '../mcp/session-policy';
import type { ProviderStatus } from './provider.interface';

export type ReserveRequirements={options?:unknown;preserveMcp?:boolean;hasImages?:boolean;pinnedReview?:boolean};
export type ReserveProject={provider:string;aiReserva:unknown;aiModels:unknown};
export type ReserveCandidate={id:string;nome:string;model:string|null;status:ProviderStatus};
export type ReserveRegistry={has(id:string):boolean;status(id:string,maxAgeMs?:number):Promise<ProviderStatus>};
const options=(raw:unknown)=>raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
export function reservePin(requirements:ReserveRequirements):string|null{
  const o=options(requirements.options);
  if(requirements.pinnedReview)return 'resolução vinculada à conexão aprovada';
  if(nativeImageTarget(o.visualAsset)||o.visualAsset)return 'produção visual nativa';
  if(o.model!==undefined&&o.model!==null&&o.model!=='')return 'modelo explicitamente fixado na etapa';
  if(Array.isArray(o.visualReferences)&&o.visualReferences.length)return 'referências visuais nativas';
  return null;
}
export function reserveCompatibility(id:string,project:ReserveProject,status:ProviderStatus,requirements:ReserveRequirements):string|null{
  if(!tipoDe(id)||!status.isAi||!['cli','api'].includes(status.kind))return 'não é executor de IA elegível';
  if(!status.available)return 'conexão indisponível';
  if(requirements.preserveMcp&&!supportsProjectMcp(id))return 'não preserva ferramentas MCP disponíveis na origem';
  const o=options(requirements.options);
  // At present the direct image-attachment path is implemented in Codex.
  // Do not infer native visual transport from a provider's general claims.
  if((requirements.hasImages||Array.isArray(o.images)&&o.images.length)&&!isCodex(id))return 'não preserva o transporte de imagens anexadas';
  const assessment=assessModel(id,selectedModel(projectModel(project,id),o),status,o);
  return assessment.state==='incompatible'?assessment.reason:null;
}
/** Configured order is intentional. Only skip proven incompatibility; CLI
 * capability unknown is not a reason to stop an otherwise valid job. */
export async function chooseReserve(input:{project:ReserveProject;registry:ReserveRegistry;from:string;requirements:ReserveRequirements;knownIds:readonly string[];cooling:(id:string)=>boolean;includeCurrent?:boolean;onSkip?:(id:string,reason:string)=>void}):Promise<ReserveCandidate|null>{
  const {project,registry,from,requirements}=input;
  if(reservePin(requirements))return null;
  const candidates=[...(input.includeCurrent?[project.provider]:[]),...(Array.isArray(project.aiReserva)?project.aiReserva.filter((x):x is string=>typeof x==='string'):[])];
  for(const id of new Set(candidates)){
    if(id===from||!input.knownIds.includes(id)||!registry.has(id))continue;
    if(input.cooling(id)){input.onSkip?.(id,'aguarda recurso após falha recente');continue;}
    // No catalog request needed for a known adapter mismatch.
    if(requirements.preserveMcp&&!supportsProjectMcp(id)){input.onSkip?.(id,'MCP incompatível');continue;}
    if(requirements.hasImages&&!isCodex(id)){input.onSkip?.(id,'transporte visual incompatível');continue;}
    try{
      const status=await registry.status(id,15000);
      const reason=reserveCompatibility(id,project,status,requirements);
      if(reason){input.onSkip?.(id,reason);continue;}
      const model=assessModel(id,selectedModel(projectModel(project,id),requirements.options),status,requirements.options).model;
      return {id,nome:status.label,model,status};
    }catch{input.onSkip?.(id,'não foi possível consultar ou validar a conexão');}
  }
  return null;
}
