import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeSessionContextFile } from '../common/session-context-file';
import { parseVisualProfile } from './visual-profile';
import { findGlassVariant } from './visual-style-catalog';
import { findVisualPalette, STYLE_FOUNDATIONS, VISUAL_DENSITIES } from './visual-token-catalog';
import { VISUAL_FONTS } from './visual-typography-catalog';
import { LIQUI_UPSTREAM_COMMIT, LIQUID_GLASS_TEMPLATE_VERSION, liquidGlassTemplateContext } from './liquid-glass-template';
import { visualFontAssetsContext } from './visual-font-assets';

/** Only explicit, validated choices become a bound package. Never invent a
 * default for an incomplete visual decision or force a different stack. */
export function approvedDesign(value:unknown, revision:number) {
  let p;
  try { p=parseVisualProfile(value); } catch { return null; }
  if(!p || p.styleId!=='liquid-glass'||!p.glassVariantId||!p.paletteId||!p.theme||!p.density||!p.fonts?.heading||!p.fonts.body||!p.fonts.mono)return null;
  const palette=findVisualPalette(p.paletteId), variant=findGlassVariant(p.glassVariantId);
  const density=VISUAL_DENSITIES.find(d=>d.id===p.density);
  const foundation=STYLE_FOUNDATIONS.find(f=>f.styleId===p.styleId);
  const font=(id:string,role:'heading'|'body'|'mono')=>VISUAL_FONTS.find(f=>f.id===id&&f.roles.includes(role));
  const heading=font(p.fonts.heading,'heading'),body=font(p.fonts.body,'body'),mono=font(p.fonts.mono,'mono');
  if(!palette||!variant||!density||!foundation||!heading||!body||!mono||!Number.isSafeInteger(revision)||revision<0)return null;
  return {
    schemaVersion:1,revision,profile:p,
    engine:{name:'liqui-design',version:LIQUID_GLASS_TEMPLATE_VERSION,commit:LIQUI_UPSTREAM_COMMIT},
    colors:{light:palette.light,dark:palette.dark},density,foundation,
    fonts:{heading:heading.stack,body:body.stack,mono:mono.stack},
  };
}

/** A ready-to-import adapter, not another optical implementation. The
 * application supplies real pages and semantic controls as children. */
export function approvedDesignSource(design:NonNullable<ReturnType<typeof approvedDesign>>):string{
  return [
    "import * as React from 'react';",
    "import { NivooGlassRoot,NivooGlassSurface,NivooGlassBackdrop } from './engine/nivoo';",
    "import './fonts/fonts.css';",
    "import './approved-design.css';",
    'export const approvedDesign = '+JSON.stringify(design,null,2)+' as const;',
    'type RootProps = Omit<React.HTMLAttributes<HTMLDivElement>,"children"> & { children:React.ReactNode; backdrop?:React.ReactNode };',
    'export function ApprovedDesignRoot({children,backdrop,className,style,...rest}:RootProps){',
    '  const theme=String(approvedDesign.profile.theme);',
    '  const [systemDark,setSystemDark]=React.useState(()=>typeof window!=="undefined"&&window.matchMedia("(prefers-color-scheme: dark)").matches);',
    '  React.useEffect(()=>{if(theme!=="system"||typeof window==="undefined")return;const media=window.matchMedia("(prefers-color-scheme: dark)");const update=()=>setSystemDark(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[theme]);',
    '  const dark=theme==="dark"||(theme==="system"&&systemDark);',
    '  const colors=approvedDesign.colors[dark?"dark":"light"];',
    '  const vars:Record<string,string>={};',
    '  for(const [k,v] of Object.entries(colors))vars["--nv-color-"+k]=v;',
    '  for(const [k,v] of Object.entries(approvedDesign.density.spacing))vars["--nv-space-"+k]=v+"px";',
    '  for(const [k,v] of Object.entries(approvedDesign.foundation.radius))vars["--nv-radius-"+k]=v+"px";',
    '  for(const [k,v] of Object.entries(approvedDesign.foundation.shadow))vars["--nv-shadow-"+k]=v;',
    '  for(const [k,v] of Object.entries(approvedDesign.fonts))vars["--nv-font-"+k]=v;',
    '  vars["--nv-control-height"]=approvedDesign.density.controlMinHeight+"px";',
    '  vars["--nv-touch-height"]=approvedDesign.density.touchMinHeight+"px";',
    '  vars["--nv-table-row-height"]=approvedDesign.density.tableRowMinHeight+"px";',
    '  vars["--nv-border-width"]=approvedDesign.foundation.borderWidth+"px";',
    '  vars["--nv-liqui-solid"]=colors.surface;vars["--nv-liqui-text"]=colors.text;',
    '  return <NivooGlassRoot {...rest} variant={approvedDesign.profile.glassVariantId} dark={dark} accent={colors.accent} textColor={colors.text} mutedColor={colors.muted} backdrop={backdrop??<NivooGlassBackdrop dark={dark}/>} className={["nv-approved-design",className].filter(Boolean).join(" ")} data-nivoo-profile-revision={approvedDesign.revision} data-nivoo-design-engine={approvedDesign.engine.name} data-nivoo-palette={approvedDesign.profile.paletteId} data-nivoo-density={approvedDesign.profile.density} style={{...style,...vars,fontFamily:approvedDesign.fonts.body,colorScheme:dark?"dark":"light"} as React.CSSProperties}>{children}</NivooGlassRoot>;',
    '}',
    'export { NivooGlassSurface as ApprovedDesignSurface };',
    '',
  ].join('\n');
}

export function approvedDesignContext(value:unknown,revision:number,worktree?:string):string[]{
  const design=approvedDesign(value,revision);
  if(!worktree||!design)return [];
  const target='templates-nivoo/liquid-glass/';
  // Use the same engine binaries/sources as the selector; no UI-specific copy
  // of the optics. Selected fonts are materialized alongside the adapter.
  liquidGlassTemplateContext(worktree);
  const fontInfo=visualFontAssetsContext(value,worktree,target+'fonts/');
  if(!fs.existsSync(path.join(worktree,'contexto',target,'fonts','fonts.css')))return ['Não foi possível materializar o pacote de design aprovado: fontes indisponíveis. Não declare aplicação fiel.'];
  writeSessionContextFile(worktree,target+'approved-design.tsx',approvedDesignSource(design));
  writeSessionContextFile(worktree,target+'approved-design.css',[
    '.nv-approved-design :where(h1,h2,h3,h4,h5,h6){font-family:var(--nv-font-heading)}',
    '.nv-approved-design :where(code,pre,kbd,samp){font-family:var(--nv-font-mono)}',
    '.nv-approved-design :where(button,input,select,textarea){font-family:var(--nv-font-body)}',
  ].join('\n')+'\n');
  writeSessionContextFile(worktree,target+'approved-profile.json',JSON.stringify(design,null,2)+'\n');
  return [
    '## Design aprovado — módulo React pronto para integração',
    'O pacote local de revisão '+revision+' em contexto/'+target+' contém approved-design.tsx, approved-design.css, approved-profile.json, engine/ e fonts/. Copie estes cinco itens juntos para uma pasta do frontend real; importe ApprovedDesignRoot no shell e ApprovedDesignSurface nas superfícies ópticas. Não escreva de novo os parâmetros ou o motor. Preserve fontes/licenças. O registry/ permanece referência para os componentes compatíveis.',
    'Use as variáveis --nv-color-<papel>, --nv-space-<xs|sm|md|lg|xl>, --nv-radius-<control|panel|overlay>, --nv-font-<heading|body|mono>, --nv-control-height, --nv-touch-height e --nv-table-row-height nos controles, conteúdo e estados reais. A raiz acompanha o tema aprovado. Não copie as telas de demonstração nem substitua o domínio, a navegação ou a API. Não aplique fora do escopo. Se a pilha não for React, não a troque sem aprovação.',
    'Ao implementar interface compatível com este perfil, integre o módulo no fluxo real; a mera presença dos arquivos não é entrega. Na conferência já prevista, observe no DOM a raiz data-nivoo-profile-revision='+revision+' e superfícies reais .liqui-glass, fontes carregadas, navegação e operação. O atributo sozinho não prova fidelidade nem funcionalidade.',
    ...fontInfo,
  ];
}
