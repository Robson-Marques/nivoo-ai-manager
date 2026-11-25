import { VISUAL_STYLES,findVisualStyle,visualStyleCatalog } from '../../src/projects/visual-style-catalog';
import { parseVisualProfileUpdate,visualProfileContext } from '../../src/projects/visual-profile';

describe('Catálogo de estilos Nivoo',()=>{
  const ids=['liquid-glass','minimalist','corporate','premium-dark'];
  it('tem IDs estáveis e metadados de apresentação sem ativos remotos',()=>{
    const catalog=visualStyleCatalog();
    expect(catalog.version).toBe(1);
    expect(catalog.styles.map(s=>s.id)).toEqual(ids);
    expect(new Set(catalog.styles.map(s=>s.id)).size).toBe(ids.length);
    for(const s of VISUAL_STYLES){
      expect(s.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.guidance).toBeTruthy();
      expect(s.suitableFor.length).toBeGreaterThan(0);
      expect(s.preview).toEqual(expect.objectContaining({surface:expect.any(String),outline:expect.any(String),shape:expect.any(String),depth:expect.any(String)}));
      expect(findVisualStyle(s.id)).toBe(s);
    }
    expect(JSON.stringify(catalog)).not.toMatch(/https?:\/\//);
    expect(findVisualStyle('__proto__')).toBeUndefined();
    expect(findVisualStyle('unknown')).toBeUndefined();
  });
  it('aceita qualquer escolha válida sem forçar tema, fonte, paleta ou densidade',()=>{
    for(const id of ids){
      const p={schemaVersion:1,mode:'guided',styleId:id,theme:'light'};
      expect(parseVisualProfileUpdate({expectedRevision:0,profile:p}).profile).toEqual(p);
      const t=visualProfileContext(p,1).join('\n');
      expect(t).toContain('Direção do estilo '+findVisualStyle(id)!.name);
      expect(t).toContain('Tema: light');
      for(const other of VISUAL_STYLES.filter(s=>s.id!==id))expect(t).not.toContain('Direção do estilo '+other.name+':');
    }
    expect(visualProfileContext({schemaVersion:1,mode:'delegated'},1).join('\n')).not.toContain('Direção do estilo');
    expect(visualProfileContext(null,0)).toEqual([]);
  });
});
