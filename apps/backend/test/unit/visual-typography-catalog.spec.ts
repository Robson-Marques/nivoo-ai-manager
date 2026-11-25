import { VISUAL_FONTS,FONT_PAIRINGS,findVisualFont,visualFontSupports,visualTypographyCatalog,selectedTypographyContext,type FontRole } from '../../src/projects/visual-typography-catalog';
import { findVisualStyle } from '../../src/projects/visual-style-catalog';
import { parseVisualProfileUpdate,visualProfileContext } from '../../src/projects/visual-profile';

describe('Catálogo de tipografia Nivoo',()=>{
  const roles:readonly FontRole[]=['heading','body','mono'];
  it('fornece IDs únicos, papéis, fallback e referência de licença',()=>{
    const c=visualTypographyCatalog();
    expect(c.version).toBe(1);
    expect(c.fonts).toHaveLength(8);
    expect(new Set(c.fonts.map(f=>f.id)).size).toBe(c.fonts.length);
    for(const f of VISUAL_FONTS){
      expect(findVisualFont(f.id)).toBe(f);
      expect(f.stack).toBeTruthy();
      expect(f.roles.length).toBeGreaterThan(0);
      if(f.availability==='system'){
        expect(f.source).toBeNull();expect(f.license).toBeNull();
      }else{
        expect(f.source).toMatch(/^https:\/\/github\.com\//);expect(f.license).toBe('OFL-1.1');
      }
      for(const role of roles)expect(visualFontSupports(f.id,role)).toBe(f.roles.includes(role));
    }
    expect(findVisualFont('__proto__')).toBeUndefined();
    expect(visualFontSupports('unknown','body')).toBe(false);
  });
  it('mantém combinações válidas e compatíveis com estilos existentes',()=>{
    expect(FONT_PAIRINGS).toHaveLength(5);
    expect(new Set(FONT_PAIRINGS.map(p=>p.id)).size).toBe(5);
    for(const p of FONT_PAIRINGS){
      for(const role of roles)expect(visualFontSupports(p.fonts[role],role)).toBe(true);
      for(const id of p.styleIds)expect(findVisualStyle(id)).toBeDefined();
      expect(parseVisualProfileUpdate({expectedRevision:0,profile:{schemaVersion:1,mode:'guided',fonts:p.fonts}}).profile?.fonts).toEqual(p.fonts);
    }
  });
  it('deduplica famílias escolhidas sem carregar fontes não selecionadas',()=>{
    const lines=selectedTypographyContext({heading:'inter',body:'inter',mono:'system-mono'});
    expect(lines.filter(l=>l.includes('Família Inter:'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('Manrope');
    expect(lines.join('\n')).not.toContain('https://');
    expect(lines.join('\n')).toContain('fallback');
    expect(selectedTypographyContext(undefined)).toEqual([]);
    expect(visualProfileContext({schemaVersion:1,mode:'delegated'},1).join('\n')).not.toContain('Família ');
    expect(selectedTypographyContext({body:'ibm-plex-mono'}).join('\n')).toContain('incompatível');
  });
});
