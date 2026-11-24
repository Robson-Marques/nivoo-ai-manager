import type { Job,Step } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ArtifactStoreService } from '../../storage/artifact-store.service';
import type { ExecutionResult } from '../../providers/provider.interface';
import { mediaOutputs } from '../../jobs/workflow/media-dependencies';
import { readMotionInvocations,normalizeMotionOutputs } from '../../jobs/motion/command';
import { caminhoRealDoVideo,inspecionarVideoGerado,videoGeradoPorEtapa } from '../../jobs/native-video-result';
import { sha256File } from '../../common/hash';
import * as fs from 'node:fs';

type Ownership=Pick<Job,'id'|'projectId'|'defaultProvider'>;
type OutputStep=Pick<Step,'id'|'key'|'provider'|'instructions'|'providerOptions'|'verifyCommand'>;
export type MediaSnapshot=Map<string,string|null>;

/** Only declared producers own durable media outputs. A criterion or prompt
 * mentioning an existing video is not proof of authorship. */
export function durableMediaOutputs(job:Ownership,step:OutputStep):string[]{
  const declared=mediaOutputs(step,job.defaultProvider);
  // Legacy plans sometimes rendered in the actual deterministic verification.
  const legacy=declared.length?[]:readMotionInvocations(normalizeMotionOutputs(step.verifyCommand??'').command).flatMap(op=>op.output?[op.output]:[]);
  return [...new Set([...declared,...legacy])].filter(p=>/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/i.test(p));
}
export function mediaIdentity(mediaDir:string,name:string):string|null{
  try{
    const file=caminhoRealDoVideo(mediaDir,name);
    if(!file)return null;
    const s=fs.statSync(file);
    return s.isFile()?JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]):null;
  }catch{return null;}
}
export function captureMediaOutputs(job:Ownership,step:OutputStep,mediaDir:string):MediaSnapshot{
  return new Map(durableMediaOutputs(job,step).map(name=>[name,mediaIdentity(mediaDir,name)]));
}
export function changedMediaOutputs(before:MediaSnapshot,identify:(name:string)=>string|null):string[]{
  return [...before].flatMap(([name,old])=>{const current=identify(name);return current!==null&&current!==old?[name]:[];});
}
export async function publishAttemptMedia(artifacts:ArtifactStoreService,job:Ownership,step:OutputStep,attemptId:string,mediaDir:string,before:MediaSnapshot,result:ExecutionResult,verified:boolean){
  if(!verified||result.exitCode!==0||result.interrupted||result.resourceUnavailable)return [];
  const produced=changedMediaOutputs(before,name=>mediaIdentity(mediaDir,name));
  if(!produced.length)return [];
  return artifacts.registrarVideosDoTrabalho({projectId:job.projectId,jobId:job.id,stepId:step.id,attemptId},mediaDir,produced);
}

/** Existing output can be recovered only with provenance from the SAME
 * producer's previous attempt and identical bytes. No arbitrary old MP4. */
export async function recoverRenderedOutput(prisma:PrismaService,job:Ownership,step:OutputStep,mediaDir:string){
  const provider=step.provider??job.defaultProvider;
  const opts=(step.providerOptions??{}) as Record<string,unknown>;
  const name=videoGeradoPorEtapa(provider,step.instructions,opts);
  if(provider!=='local-shell'||!name)return {kind:'none' as const};
  const absolute=caminhoRealDoVideo(mediaDir,name);
  if(!absolute)return {kind:'none' as const};
  const artifact=await prisma.artifact.findFirst({
    where:{projectId:job.projectId,jobId:job.id,stepId:step.id,name,kind:'FILE',mimeType:'video/mp4'},
    orderBy:{createdAt:'desc'},
  });
  if(artifact?.attemptId){
    const attempt=await prisma.attempt.findFirst({where:{id:artifact.attemptId,jobId:job.id,stepId:step.id,provider,status:{in:['SUCESSO','INTERROMPIDA']}}});
    if(attempt){
      const check=inspecionarVideoGerado(mediaDir,name,provider,step.instructions,opts);
      if(check.ok&&check.absolutePath&&await sha256File(check.absolutePath)===artifact.sha256)
        return {kind:'recovered' as const,detail:check.detail};
    }
  }
  return {kind:'conflict' as const,detail:'O MP4 de saída já existe em '+name+', mas não há prova íntegra de que foi produzido por esta etapa deste trabalho. O vídeo foi preservado. Escolha uma nova saída ou retome a origem correta.'};
}
