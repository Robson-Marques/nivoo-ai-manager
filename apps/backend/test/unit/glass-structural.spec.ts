import { GLASS_MATERIAL_CSS } from '../../src/projects/liquid-glass-material';
import { liquidGlassCss } from '../../src/projects/liquid-glass-template';
import { visualProfileContext } from '../../src/projects/visual-profile';
describe('Identidade estrutural Liquid Glass',()=>{
  it('reutiliza o material no template e preserva alternativas opacas',()=>{
    expect(liquidGlassCss()).toContain(GLASS_MATERIAL_CSS);
    for(const id of ['crystal-glass','frosted-glass','dark-glass','prism-glass'])expect(GLASS_MATERIAL_CSS).toContain(id);
    for(const cls of ['nv-glass-stage','nv-glass-material','nv-glass-panel','nv-glass-content','nv-glass-control','nv-glass-primary','nv-glass-overlay'])expect(GLASS_MATERIAL_CSS).toContain('.'+cls);
    expect(GLASS_MATERIAL_CSS).toContain('prefers-reduced-transparency');
    expect(GLASS_MATERIAL_CSS).toContain('forced-colors');
    expect(GLASS_MATERIAL_CSS).toContain('data-transparency="opaque"');
    expect(visualProfileContext({schemaVersion:1,mode:'guided',styleId:'liquid-glass'},1).join('\n')).toContain('Identidade estrutural');
  });
});
