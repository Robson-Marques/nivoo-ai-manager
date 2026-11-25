import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseVisualProfile } from './visual-profile';
import { writeSessionContextFile } from '../common/session-context-file';
const FONTS=[{"id":"inter","family":"Inter","files":[["inter.ttf","100 900"]],"license":"inter-OFL.txt"},{"id":"manrope","family":"Manrope","files":[["manrope.ttf","200 800"]],"license":"manrope-OFL.txt"},{"id":"ibm-plex-sans","family":"IBM Plex Sans","files":[["ibm-plex-sans.ttf","100 700"]],"license":"ibm-plex-sans-OFL.txt"},{"id":"ibm-plex-serif","family":"IBM Plex Serif","files":[["ibm-plex-serif-400.ttf","400"],["ibm-plex-serif-600.ttf","600"]],"license":"ibm-plex-serif-OFL.txt"},{"id":"ibm-plex-mono","family":"IBM Plex Mono","files":[["ibm-plex-mono.ttf","400"]],"license":"ibm-plex-mono-OFL.txt"}] as const;
/** Only selected and validated fonts, copied as original binaries with licenses.
 * No CDN, package install, network or base64 in the prompt. */
export function visualFontAssetsContext(profile:unknown,worktree?:string):string[]{
  if(!worktree)return [];
  let p;try{p=parseVisualProfile(profile);}catch{return [];}
  const selected=new Set(Object.values(p?.fonts??{}));
  const fonts=FONTS.filter(font=>selected.has(font.id));
  if(!fonts.length)return [];
  const root=path.resolve(__dirname,'../../../web/public/visual-fonts');
  const target='templates-nivoo/visual-fonts/';
  const css:string[]=[];
  for(const font of fonts){
    const names=[...font.files.map(([file])=>file),font.license];
    if(names.some(name=>!fs.existsSync(path.join(root,name))))return ['Fontes selecionadas: ativos locais indisponíveis; não declare que a fonte original está aplicada.'];
  }
  for(const font of fonts){
    for(const [file,weight] of font.files){
      writeSessionContextFile(worktree,target+file,fs.readFileSync(path.join(root,file)));
      css.push('@font-face{font-family:"'+font.family+'";src:url("./'+file+'") format("truetype");font-weight:'+weight+';font-style:normal;font-display:swap}');
    }
    writeSessionContextFile(worktree,target+font.license,fs.readFileSync(path.join(root,font.license)));
  }
  writeSessionContextFile(worktree,target+'fonts.css',css.join('\n')+'\n');
  return ['Fontes originais OFL selecionadas disponíveis em contexto/templates-nivoo/visual-fonts/ (fonts.css, TTF e licenças). Copie somente os ativos necessários ao frontend real, preserve as licenças e use as famílias escolhidas; sem CDN.'];
}
