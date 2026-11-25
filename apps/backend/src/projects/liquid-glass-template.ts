import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeSessionContextFile } from '../common/session-context-file';

export const LIQUID_GLASS_TEMPLATE_VERSION=2;
export const LIQUI_UPSTREAM_COMMIT='27fea1b66069fcb8dcce133486c6fe5f49744db9';
export const LIQUI_CORE_FILES=["LICENSE","LiquiGlass.tsx","backdrop.tsx","filterRegistry.ts","glass.css","index.ts","theme.tsx","tokens.ts","nivoo.tsx","nivoo-layout.css"] as const;
const ROOT=path.resolve(__dirname,'../../../web/src/vendor/liqui');
const GUIDE=`# Liquid Glass — Liqui Design original (MIT)
Motor 0.8.0, commit ${LIQUI_UPSTREAM_COMMIT}. Copie a pasta engine para o frontend React 18/19; importe NivooGlassRoot e NivooGlassSurface de engine/nivoo. Preserve LICENSE. O adaptador e os presets são exatamente os que a prévia do Nivoo utiliza. Nenhuma dependência adicional além de React/React DOM no núcleo.
NivooGlassRoot recebe variant, dark, accent, backdrop (ReactNode) e children. Use o tema aprovado; glassPreset usa Frosted/defaultGlassTheme, Prism/prismGlassTheme, Crystal e Dark como adaptações explícitas. Aplique em todo o design system, usando NivooGlassSurface com raio, refraction e bezel adequados. Não recrie efeito óptico CSS. Preserve a semântica dos controles e conteúdo denso opaco. Para componentes do registry veja components.md. Se o projeto não usa React, explique a incompatibilidade e não mude a pilha sem aprovação. Não alegue refração em navegador sem suporte, nem equivalência a Apple. Confira visual real, funcionalidade, contraste, foco, toque, responsividade e fallback. Os arquivos de exemplo não são o produto.
`;
export function liquidGlassTemplate(){
  return {id:'liquid-glass',version:LIQUID_GLASS_TEMPLATE_VERSION,engine:'liqui-design',upstreamCommit:LIQUI_UPSTREAM_COMMIT,files:[
    {name:'README.md',content:GUIDE},
    ...LIQUI_CORE_FILES.map(name=>({name:'engine/'+name,content:fs.readFileSync(path.join(ROOT,name),'utf8')})),
  ]};
}
export function liquidGlassTemplateContext(worktree?:string):string[]{
  if(!worktree)return [];
  for(const file of liquidGlassTemplate().files)writeSessionContextFile(worktree,'templates-nivoo/liquid-glass/'+file.name,file.content);
  return ['Liquid Glass original (Liqui Design MIT): contexto/templates-nivoo/liquid-glass/README.md e engine/nivoo.tsx. Reutilize o núcleo local e presets da prévia, não invente CSS óptico.'];
}
