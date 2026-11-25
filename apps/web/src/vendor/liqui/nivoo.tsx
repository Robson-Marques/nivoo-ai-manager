import * as React from 'react';
import { LiquiBackdrop,LiquiGlass,LiquiThemeProvider,defaultGlassTheme,prismGlassTheme,defaultTokens,LIQUI_TOKENS,type LiquiGlassTheme,type LiquiGlassProps } from './index';
import './nivoo-layout.css';

export const GLASS_PRESETS={
  'crystal-glass':{...defaultGlassTheme,frost:0.16,material:'auto',specular:0.95},
  'frosted-glass':defaultGlassTheme,
  'dark-glass':{...defaultGlassTheme,frost:0.64,material:'auto'},
  'prism-glass':prismGlassTheme,
} satisfies Record<string,LiquiGlassTheme>;
export type NivooGlassVariant=keyof typeof GLASS_PRESETS;
export function glassPreset(id?:string):LiquiGlassTheme{
  return id&&Object.prototype.hasOwnProperty.call(GLASS_PRESETS,id)?GLASS_PRESETS[id as NivooGlassVariant]:defaultGlassTheme;
}
export function NivooGlassRoot({variant,dark,accent,textColor,mutedColor,backdrop,children,className,style,...rest}:React.HTMLAttributes<HTMLDivElement>&{variant?:string;dark:boolean;accent?:string;textColor?:string;mutedColor?:string;backdrop:React.ReactNode}){
  const tokens=defaultTokens[dark?'dark':'light'];
  const vars:Record<string,string>={};
  for(const key of LIQUI_TOKENS)vars['--lq-'+key]=tokens[key];
  if(accent)vars['--lq-accent']=accent;
  if(textColor)vars['--lq-text']=textColor;
  if(mutedColor)vars['--lq-text-dim']=mutedColor;
  return <LiquiThemeProvider theme={{glass:glassPreset(variant)}} injectTokens={false}>
    <LiquiBackdrop {...rest} className={['nv-liqui-root',className].filter(Boolean).join(' ')} data-theme={dark?'dark':'light'} data-glass-variant={variant??'frosted-glass'} backdrop={backdrop} style={{...vars,...style} as React.CSSProperties}>{children}</LiquiBackdrop>
  </LiquiThemeProvider>;
}
/** Same backdrop supplied to the optical engine in the visual selector.
 * This paints a background only; the original LiquiGlass performs refraction. */
export function NivooGlassBackdrop({dark}:{dark:boolean}){
  return <div aria-hidden="true" style={{position:'absolute',inset:0,zIndex:-1,pointerEvents:'none',background:dark
    ?'linear-gradient(145deg,#070c19 0 34%,#2a4464 34% 55%,#132f45 55% 72%,#060e1e 72%)'
    :'linear-gradient(145deg,#f4f8fc 0 34%,#b9cce5 34% 55%,#d7e7ee 55% 72%,#eef1f8 72%)'}}/>;
}
/** Original optical surface; content and native control semantics are supplied by the consumer. */
export function NivooGlassSurface(props:LiquiGlassProps){return <LiquiGlass {...props}/>;}
export { LiquiGlass,LiquiBackdrop,LiquiThemeProvider,defaultGlassTheme,prismGlassTheme,defaultTokens } from './index';
