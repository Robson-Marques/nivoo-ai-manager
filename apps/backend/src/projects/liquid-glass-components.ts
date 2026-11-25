import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeSessionContextFile } from '../common/session-context-file';
import { LIQUI_UPSTREAM_COMMIT,LIQUID_GLASS_TEMPLATE_VERSION } from './liquid-glass-template';
export const LIQUID_GLASS_COMPONENTS_VERSION=2;
const IDS=["button","checkbox","field","accordion","alert-dialog","context-menu","dialog","popover","tooltip","switch","slider","select","tabs","tab-bar","toggle","toggle-group","menu","radio-group","progress","menubar","number-field","toast","separator","avatar","collapsible","meter","input","fieldset","form","checkbox-group","scroll-area","toolbar","preview-card","navigation-menu","combobox","autocomplete","drawer","otp-field"] as const;
const ROOT=path.resolve(__dirname,'../../../web/vendor/liqui-registry');
const GUIDE=`# Componentes originais Liqui Design
38 componentes do registry original (MIT, Fan Li, commit ${LIQUI_UPSTREAM_COMMIT}). A licença está em engine/LICENSE. Consulte registry/registry.json para dependências e cssVars. Os arquivos originais mantêm aliases @/lib/utils e @/registry/liqui/... e imports @liqui-design/glass. Se usar o núcleo vendorizado, adapte os imports para engine/index, mantendo a implementação óptica idêntica; resolva os aliases conforme a estrutura do projeto. O registry usa Tailwind CSS v4 e dependências indicadas (Base UI, CVA, clsx, tailwind-merge etc.). Não instale tudo automaticamente; selecione somente componentes pertinentes e dependências transitivas. A adoção integral em React utiliza Tailwind v4 e os componentes originais; se houver incompatibilidade material com a pilha, declare a exceção antes de aprovar o plano. Não substitua controles por adaptadores próprios sem autorização. Nunca substitua o motor por uma imitação CSS. Preserve LICENSE, contratos, validações e estados reais. Não mude framework sem autorização.
`;
export function liquidGlassComponents(){
  const paths=['registry.json','lib/lens.tsx','lib/utils.ts',...IDS.map(id=>'ui/'+id+'.tsx')];
  return {id:'liquid-glass-components',version:LIQUID_GLASS_COMPONENTS_VERSION,requires:{id:'liquid-glass',version:LIQUID_GLASS_TEMPLATE_VERSION},upstreamCommit:LIQUI_UPSTREAM_COMMIT,components:IDS.map(id=>({id,name:id})),files:[
    {name:'components.md',content:GUIDE},...paths.map(name=>({name:'registry/'+name,content:fs.readFileSync(path.join(ROOT,name),'utf8')})),
  ]};
}
/** Full original component library with import wiring only. All optical and
 * component behavior remains upstream. No custom CSS imitation. */
export function liquidGlassIntegratedFiles():Array<{name:string;content:string}>{
  const bundle=liquidGlassComponents();
  return bundle.files.filter(f=>f.name.startsWith('registry/')).map(f=>{
    if(!/\.(?:ts|tsx)$/.test(f.name))return f;
    const content=f.content.replace(/(\bfrom\s*['"])(@liqui-design\/glass|@\/(?:registry\/liqui\/)?(?:lib|ui)\/[\w/-]+)(['"])/g,(_m,start,spec,end)=>{
      const target=spec==='@liqui-design/glass'?'engine/index':'registry/'+spec.replace(/^@\/(?:registry\/liqui\/)?/,'');
      const relative=path.posix.relative(path.posix.dirname(f.name),target);
      return start+(relative.startsWith('.')?relative:'./'+relative)+end;
    });
    return {...f,content};
  });
}
export function liquidGlassComponentsContext(worktree?:string):string[]{
  if(!worktree)return [];
  for(const file of liquidGlassIntegratedFiles())writeSessionContextFile(worktree,'templates-nivoo/liquid-glass/'+file.name,file.content);
  writeSessionContextFile(worktree,'templates-nivoo/liquid-glass/components.md',GUIDE+'\nO registry desta cópia já está ligado ao motor e às dependências internas por imports relativos. Adoção integral: copie a biblioteca inteira, configure Tailwind v4 e as dependências pertinentes do registry.json, e consuma os componentes originais nos callsites reais. Não reimplemente os controles por conveniência.');
  return ['Componentes originais Liqui Design MIT: contexto/templates-nivoo/liquid-glass/components.md e registry/registry.json; leia apenas os componentes necessários em registry/ui/. Preserve o núcleo engine e licença; respeite a tecnologia e as dependências aprovadas.'];
}
