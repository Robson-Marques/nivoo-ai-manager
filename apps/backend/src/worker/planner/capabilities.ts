import type { AreaScope } from '../../specialties/media/scope';
import { mediaEnabledForArea } from '../../specialties/media/scope';
import { softwareInterfaceEnabled } from '../../specialties/scope';
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
  const media=mediaEnabledForArea(area);
  const softwareInterface=softwareInterfaceEnabled(area);
  const paidVideo=media&&registry.has('gemini-video')&&(await registry.status('gemini-video',15_000)).available;
  return {media,softwareInterface,paidVideo};
}
