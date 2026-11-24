import type { AreaScope } from '../../specialties/media/scope';
import { mediaEnabledForArea } from '../../specialties/media/scope';
import type { ProviderRegistry } from '../../providers/provider-registry.service';

export interface PlannerCapabilities {
  media:boolean;
  softwareInterface:boolean;
  paidVideo:boolean;
}

/** Select capabilities from the configured area; only query optional providers
 * for specialties that can use them. Keep general/legacy projects compatible.
 */
export async function selectPlannerCapabilities(area:AreaScope|undefined,registry:Pick<ProviderRegistry,'has'|'status'>):Promise<PlannerCapabilities>{
  const template=area?.template||area?.slug||'generica';
  const media=mediaEnabledForArea(area);
  const general=template==='geral'||template==='generica';
  // Unknown non-media templates keep their previous software tools.
  const softwareInterface=general||(!media&&template!=='atendimento');
  const paidVideo=media&&registry.has('gemini-video')&&(await registry.status('gemini-video',15_000)).available;
  return {media,softwareInterface,paidVideo};
}
