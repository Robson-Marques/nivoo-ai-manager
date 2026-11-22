import { runVideoTool } from '../video/video-tool-adapters';

/**
 * Read-only bridge to the upstream HyperFrames registry.
 * Discovery NEVER installs blocks, imports JS/HTML, or triggers a render.
 * Search uses the official local CLI catalog, with its vocabulary tier
 * (no silent on-device model download).
 */
export type HyperFramesCatalogItem = {
  name:string;
  type:'block'|'component';
  title:string;
  description:string;
  tags:string[];
  status:'reference-only';
};
export type HyperFramesCatalogSearch = {
  query:string;
  tier:string;
  total:number;
  items:HyperFramesCatalogItem[];
  notice:string;
};

export function parseHyperFramesCatalog(raw:string,query:string):HyperFramesCatalogSearch {
  let envelope:unknown;
  try {envelope=JSON.parse(raw);}
  catch {throw new Error('O catálogo HyperFrames não retornou JSON válido');}
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))
    throw new Error('Resposta de catálogo inválida');
  const info=envelope as Record<string,unknown>;
  if(!Array.isArray(info.results)||info.results.length>2000)
    throw new Error('Catálogo HyperFrames sem resultados estruturados');
  const items:HyperFramesCatalogItem[]=[];
  const known=new Set<string>();
  for(const entry of info.results){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
    const e=entry as Record<string,unknown>;
    const type=e.type==='hyperframes:block'?'block':
      e.type==='hyperframes:component'?'component':null;
    if(!type||typeof e.name!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(e.name)||
      known.has(e.name)||typeof e.title!=='string'||typeof e.description!=='string')continue;
    known.add(e.name);
    items.push({
      name:e.name,type,
      title:e.title.slice(0,130),
      description:e.description.slice(0,350),
      tags:Array.isArray(e.tags)?e.tags.filter((v):v is string=>
        typeof v==='string'&&/^[a-z0-9-]{1,36}$/.test(v)).slice(0,12):[],
      status:'reference-only',
    });
    if(items.length===24)break;
  }
  const tier=typeof info.tier==='string'&&['words','on-device'].includes(info.tier)?info.tier:'words';
  return {query,tier,total:typeof info.total==='number'&&Number.isSafeInteger(info.total)&&info.total>=0?info.total:items.length,
    items,
    notice:'Catálogo oficial somente para consulta. Esses blocos não são executados pelo Studio antes de revisão de código e dependências.',
  };
}

export function validateCatalogSearch(query:unknown):string {
  if(typeof query!=='string')throw new Error('Informe uma busca em inglês para o catálogo');
  const normalized=query.trim().replace(/\s+/g,' ');
  if(normalized.length<2||normalized.length>90||
    !/^[a-zA-Z0-9 ]{2,90}$/.test(normalized))
    throw new Error('Busca inválida. Use 2 a 90 caracteres em inglês, sem códigos ou símbolos');
  return normalized;
}

export async function searchOfficialHyperFramesCatalog(query:unknown):Promise<HyperFramesCatalogSearch> {
  const normalized=validateCatalogSearch(query);
  const result=await runVideoTool('hyperframes',[
    'catalog','--query',normalized,'--json',
  ],'/var/lib/nivoo',25_000,undefined,{
    PATH:'/usr/local/bin:/opt/nivoo/node/bin:/usr/bin:/bin',
    HOME:'/var/lib/nivoo',LANG:'C.UTF-8',
    HYPERFRAMES_NO_TELEMETRY:'1',HYPERFRAMES_NO_UPDATE_CHECK:'1',
    HYPERFRAMES_SKIP_SKILLS:'1',DO_NOT_TRACK:'1',
  });
  if(result.exitCode!==0)throw new Error('Falha ao consultar catálogo HyperFrames: '+result.stderr.slice(-240));
  if(result.stdoutTruncated)throw new Error('Catálogo excedeu o limite: refine a busca em inglês');
  return parseHyperFramesCatalog(result.stdout,normalized);
}
