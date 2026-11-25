import {GLASS_VARIANTS,visualStyleCatalog} from '../../src/projects/visual-style-catalog';
import {parseVisualProfileUpdate,visualProfileContext,selectedVisualStyleId} from '../../src/projects/visual-profile';
import {liquidGlassCss} from '../../src/projects/liquid-glass-template';
describe('Materiais Liquid Glass',()=>{
  it('persiste somente a variante compatível, sem alterar tema ou família',()=>{
    expect(visualStyleCatalog().glassVariants.map(v=>v.id)).toEqual(['crystal-glass','frosted-glass','dark-glass','prism-glass']);
    for(const v of GLASS_VARIANTS){
      const profile={schemaVersion:1,mode:'guided',styleId:'liquid-glass',glassVariantId:v.id,theme:'light'};
      expect(parseVisualProfileUpdate({expectedRevision:0,profile}).profile).toEqual(profile);
      expect(selectedVisualStyleId(profile)).toBe('liquid-glass');
      expect(visualProfileContext(profile,1).join('\n')).toContain('data-glass-variant="'+v.id+'"');
      expect(liquidGlassCss()).toContain('[data-glass-variant="'+v.id+'"]');
      expect(()=>parseVisualProfileUpdate({expectedRevision:0,profile:{...profile,styleId:'corporate'}})).toThrow();
    }
    expect(()=>parseVisualProfileUpdate({expectedRevision:0,profile:{schemaVersion:1,mode:'guided',styleId:'liquid-glass',glassVariantId:'unknown'}})).toThrow();
    expect(parseVisualProfileUpdate({expectedRevision:0,profile:{schemaVersion:1,mode:'guided',styleId:'liquid-glass'}}).profile).toEqual({schemaVersion:1,mode:'guided',styleId:'liquid-glass'});
  });
});
