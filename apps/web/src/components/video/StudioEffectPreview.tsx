import { useState } from 'react';
import './StudioEffectPreview.css';

type CaptionEffect = 'fade'|'pop'|'slide'|'rise'|'enter-left'|'enter-right'|'karaoke';
type AssetEffect = 'fade'|'slide'|'none';

const captionEffects: {id:CaptionEffect; label:string}[] = [
  {id:'fade',label:'Aparecer'}, {id:'pop',label:'Pop'},
  {id:'slide',label:'Deslizar'}, {id:'rise',label:'Subir'},
  {id:'enter-left',label:'Da esquerda'}, {id:'enter-right',label:'Da direita'},
  {id:'karaoke',label:'Palavra a palavra'},
];
const assetEffects: {id:AssetEffect;label:string}[] = [
  {id:'fade',label:'Aparecer'}, {id:'slide',label:'Deslizar'}, {id:'none',label:'Sem efeito'},
];

export function StudioEffectPreview(props: {
  kind:'caption'|'asset';
  value:string;
  onChange:(value:string)=>void;
  hasWords?:boolean;
}) {
  const [replay,setReplay]=useState(0);
  const options=props.kind==='caption'?captionEffects:assetEffects;
  return <section className="studio-effect-picker" aria-label="Prévia das animações">
    <div className="studio-effect-head"><strong>Prévia dos efeitos</strong>
      <button type="button" onClick={()=>setReplay(n=>n+1)} title="Reproduzir novamente a animação">↻ Repetir</button>
    </div>
    <div className="studio-effect-grid">
      {options.map(effect=>{
        const disabled=effect.id==='karaoke'&&!props.hasWords;
        return <button type="button" key={effect.id} disabled={disabled}
          className={'studio-effect-option'+(props.value===effect.id?' selected':'')}
          aria-pressed={props.value===effect.id} title={disabled?'Alinhe as palavras antes de usar karaoke':effect.label}
          onClick={()=>{props.onChange(effect.id);setReplay(n=>n+1)}}>
          <span className="studio-effect-stage">
            <span key={replay+'-'+effect.id} className={'studio-effect-sample studio-effect-'+effect.id}>
              {props.kind==='caption'?'TEXTO':'▣'}
            </span>
          </span>
          <span className="studio-effect-name">{effect.label}</span>
        </button>;
      })}
    </div>
    <small>Simulação visual do movimento. A exportação final usa os efeitos suportados pelo motor FFmpeg.</small>
  </section>;
}
