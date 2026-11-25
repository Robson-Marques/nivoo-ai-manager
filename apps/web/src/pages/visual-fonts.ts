export const LOCAL_FONTS=[{"id":"inter","family":"Inter","weights":[400,600]},{"id":"manrope","family":"Manrope","weights":[400,600]},{"id":"ibm-plex-sans","family":"IBM Plex Sans","weights":[400,600]},{"id":"ibm-plex-serif","family":"IBM Plex Serif","weights":[400,600]},{"id":"ibm-plex-mono","family":"IBM Plex Mono","weights":[400]}] as const;
export type FontState='loading'|'ready'|'failed';
export type FontStates=Record<string,FontState>;
export async function loadVisualFont(font:typeof LOCAL_FONTS[number]):Promise<FontState>{
  if(!document.fonts)return 'failed';
  try{
    const faces=await Promise.all(font.weights.map(weight=>document.fonts.load(weight+' 16px "'+font.family+'"','Clientes • Visão geral · ação 123')));
    return faces.every(list=>list.length>0&&list.every(face=>face.status==='loaded'))?'ready':'failed';
  }catch{return 'failed';}
}
