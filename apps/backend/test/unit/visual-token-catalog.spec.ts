import { VISUAL_PALETTES,VISUAL_DENSITIES,STYLE_FOUNDATIONS,contrastRatio,findVisualPalette,visualTokenCatalog,selectedTokenContext } from '../../src/projects/visual-token-catalog';
import { VISUAL_STYLES } from '../../src/projects/visual-style-catalog';
import { parseVisualProfileUpdate,visualProfileContext } from '../../src/projects/visual-profile';

describe('Design tokens Nivoo',()=>{
  it('mantém catálogo estável, com fundação para cada estilo e alvos de toque',()=>{
    expect(visualTokenCatalog().version).toBe(1);
    expect(VISUAL_PALETTES.map(p=>p.id)).toEqual(['ocean-blue','emerald','violet','graphite']);
    expect(STYLE_FOUNDATIONS.map(f=>f.styleId)).toEqual(VISUAL_STYLES.map(s=>s.id));
    expect(VISUAL_DENSITIES.map(d=>d.id)).toEqual(['compact','balanced','spacious']);
    for(const d of VISUAL_DENSITIES){
      const spacing=Object.values(d.spacing);
      expect(spacing.every((n,i)=>i===0||n>spacing[i-1])).toBe(true);
      expect(d.touchMinHeight).toBeGreaterThanOrEqual(44);
      expect(d.touchMinHeight).toBeGreaterThanOrEqual(d.controlMinHeight);
    }
    expect(findVisualPalette('__proto__')).toBeUndefined();
  });
  it('verifica contraste de pares opacos, não conformidade integral de interface',()=>{
    expect(contrastRatio('#000000','#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF','#FFFFFF')).toBe(1);
    expect(()=>contrastRatio('transparent','#FFFFFF')).toThrow();
    for(const p of VISUAL_PALETTES)for(const t of [p.light,p.dark]){
      for(const c of Object.values(t))expect(c).toMatch(/^#[0-9A-F]{6}$/);
      for(const bg of [t.background,t.surface,t.surfaceRaised]){
        for(const fg of [t.text,t.muted,t.success,t.warning,t.danger,t.info])expect(contrastRatio(fg,bg)).toBeGreaterThanOrEqual(4.5);
        for(const fg of [t.controlBorder,t.focus])expect(contrastRatio(fg,bg)).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(t.accent,t.onAccent)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('carrega somente paleta, tema e densidade escolhidos',()=>{
    const p={schemaVersion:1,mode:'guided',styleId:'liquid-glass',paletteId:'emerald',theme:'light',density:'compact'};
    expect(parseVisualProfileUpdate({expectedRevision:0,profile:p}).profile).toEqual(p);
    const t=visualProfileContext(p,2).join('\n');
    expect(t).toContain('Paleta Verde esmeralda — referência clara');
    expect(t).not.toContain('referência escura');
    expect(t).not.toContain('Azul oceano');
    expect(t).toContain('controles=36; toque=44');
    expect(t).toContain('control=12; panel=20; overlay=24');
    expect(selectedTokenContext('emerald','system',undefined,undefined).join('\n')).toContain('referência escura');
    expect(selectedTokenContext('emerald',undefined,undefined,undefined).join('\n')).toContain('Tema não escolhido');
    expect(selectedTokenContext(undefined,undefined,undefined,undefined)).toEqual([]);
  });
});
