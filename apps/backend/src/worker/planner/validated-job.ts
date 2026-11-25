import type { Prisma } from '@prisma/client';
import type { JobsService } from '../../jobs/jobs.service';
import type { AreaScope } from '../../specialties/media/scope';
import type { PlannerAttachment } from './types';
import { caminhoDoProjeto } from '../../common/path-guard';

/** Both the first response and a repaired response enter the same validation boundary.
 * Only attachments copied from this conversation can be put into the project.
 */
export function validatedPlannerJob(jobs:Pick<JobsService,'validatePlan'>,response:any,providerId:string,area:AreaScope|undefined,anexos:PlannerAttachment[],visualProfile?:unknown):Prisma.InputJsonValue {
  const validado=jobs.validatePlan({...response.job,defaultProvider:providerId},area,visualProfile);
  const noProjeto=Array.isArray(response.job?.anexosNoProjeto)
    ? response.job.anexosNoProjeto
      .filter((x:any)=>anexos.some(a=>a.caminho===String(x?.anexo??''))&&caminhoDoProjeto(x?.para))
      .map((x:any)=>({anexo:String(x.anexo),para:caminhoDoProjeto(x.para) as string}))
    : [];
  return {...validado,...(noProjeto.length?{anexosNoProjeto:noProjeto}:{})} as unknown as Prisma.InputJsonValue;
}
