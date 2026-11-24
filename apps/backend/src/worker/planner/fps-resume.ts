import * as fs from 'node:fs';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import { jobsDaConversa } from '../../conversations/jobs-da-conversa';
import { mediaEnabledForArea,type AreaScope } from '../../specialties/media/scope';
import { fpsOnlyResume,resumeRenderCommand } from '../../jobs/motion/fps-resume';
import { readMotionInvocation } from '../../jobs/motion/command';
import { resolveInside } from '../../common/path-guard';

/** The narrow, explicit FPS-only continuation does not require an LLM.
 * Use only the latest actual job in this conversation, one completed render
 * and a source that still exists in that job's own worktree. */
export async function planFpsResume(prisma:PrismaService,workspace:WorkspaceService,project:{id:string;dirKey:string;area:AreaScope},conversationId:string,text:string){
  const fps=fpsOnlyResume(text);
  if(!fps||!mediaEnabledForArea(project.area))return null;
  const ids=await jobsDaConversa(prisma,conversationId);
  if(!ids.length)return null;
  const job=await prisma.job.findFirst({where:{projectId:project.id,id:{in:ids}},orderBy:{createdAt:'desc'},include:{steps:true}});
  if(!job||!['BLOQUEADO','FALHOU','CONCLUIDO'].includes(job.status))return null;
  const renders=job.steps.filter(s=>s.status==='CONCLUIDO'&&(s.provider??job.defaultProvider)==='local-shell'&&readMotionInvocation(s.instructions)?.output);
  if(renders.length!==1)return null;
  const render=renders[0],op=readMotionInvocation(render.instructions);
  if(!op?.output||!op.seconds||!op.width||!op.height)return null;
  const dirs=workspace.projectDirs(project.dirKey);
  try{
    const origin=resolveInside(dirs.worktrees,job.id);
    if(!fs.existsSync(resolveInside(origin,op.source)))return null;
    const media=resolveInside(dirs.midia,op.output.slice(6));
    if(!fs.existsSync(media)||!fs.statSync(media).isFile())return null;
    const stem=op.output.slice(0,-4).replace(/-\d+fps(?:-\d+)?$/,'');
    let target=stem+'-'+fps+'fps.mp4';
    for(let n=2;fs.existsSync(resolveInside(dirs.midia,target.slice(6)));n++){
      if(n>100)return null;
      target=stem+'-'+fps+'fps-'+n+'.mp4';
    }
    const command=resumeRenderCommand(render.instructions,job.id,fps,target);
    if(!command)return null;
    return {
      title:'Retomada técnica — '+fps+' FPS',
      objective:'Reexportar a composição original de '+job.title+' sem modificar arte, imagens, animações, resolução ou duração; '+fps+' FPS.',
      steps:[{key:'renderizar',title:'Renderizar composição preservada a '+fps+' FPS',provider:'local-shell',instructions:command,providerOptions:{motionSourceJobId:job.id}}],
      criteria:[{key:'video',kind:'FILE_EXISTS',description:'MP4 da composição original com '+fps+' FPS',config:{path:target}}],
    };
  }catch{return null;}
}
