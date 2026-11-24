import { isCodexAccount } from '../../providers/codex-image-assets';
import type { AreaScope } from '../../specialties/media/scope';
import { mediaEnabledForArea } from '../../specialties/media/scope';
import { softwareInterfaceEnabled } from '../../specialties/scope';
import type { ProviderRegistry } from '../../providers/provider-registry.service';

export interface PlannerCapabilities {
  media:boolean;
  softwareInterface:boolean;
  paidVideo:boolean;
  paidImage?:boolean;
  codexImageProvider?:string;
}

/** Select capabilities from the configured area; only query optional providers
 * for specialties that can use them. Keep general/legacy projects compatible.
 */
export async function selectPlannerCapabilities(area:AreaScope|undefined,registry:Pick<ProviderRegistry,'has'|'status'>,providerId?:string):Promise<PlannerCapabilities>{
  const media=mediaEnabledForArea(area);
  const softwareInterface=softwareInterfaceEnabled(area);
  const paidVideo=media&&registry.has('gemini-video')&&(await registry.status('gemini-video',15_000)).available;
  const paidImage=media&&registry.has('gemini-image')&&(await registry.status('gemini-image',15_000)).available;
  const codexImageProvider=media&&providerId&&isCodexAccount(providerId)&&registry.has(providerId)&&(await registry.status(providerId,15_000)).available?providerId:undefined;
  return {media,softwareInterface,paidVideo,paidImage,...(codexImageProvider?{codexImageProvider}:{})};
}
