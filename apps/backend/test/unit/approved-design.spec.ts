import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { approvedDesign,approvedDesignSource,approvedDesignContext } from '../../src/projects/approved-design';
import { liquidGlassIntent } from '../../src/specialties/software/liquid-glass';
const profile={schemaVersion:1,mode:'guided',styleId:'liquid-glass',glassVariantId:'crystal-glass',paletteId:'violet',theme:'system',density:'balanced',usage:'both',fonts:{heading:'ibm-plex-serif',body:'ibm-plex-sans',mono:'system-mono'}};
describe('Módulo de design aprovado',()=>{
  it('resolve escolhas reais e conserva os tokens da paleta sem inventar defaults',()=>{
    const d=approvedDesign(profile,7)!;
    expect(d.profile.glassVariantId).toBe('crystal-glass');
    expect(d.colors.light.accent).toBe('#6D28D9');
    expect(d.colors.dark.accent).toBe('#C4B5FD');
    expect(d.fonts.heading).toContain('IBM Plex Serif');
    expect(d.fonts.body).toContain('IBM Plex Sans');
    expect(d.density.controlMinHeight).toBe(40);
    expect(approvedDesign({...profile,theme:undefined},7)).toBeNull();
    expect(approvedDesign({...profile,paletteId:'inexistente'},7)).toBeNull();
    const source=approvedDesignSource(d);
    expect(source).toContain("from './engine/nivoo'");
    expect(source).toContain("from './fonts/fonts.css'".replace('from ',''));
    expect(source).toContain('variant={approvedDesign.profile.glassVariantId}');
    expect(source).toContain('data-nivoo-profile-revision={approvedDesign.revision}');
  });
  it('encaminha o estilo persistido para alterações de frontend, não de backend',()=>{
    expect(liquidGlassIntent('Ajustar componente React','liquid-glass')).toBe(true);
    expect(liquidGlassIntent('Corrigir consulta SQL no backend','liquid-glass')).toBe(false);
    expect(liquidGlassIntent('Remover Liquid Glass do frontend','liquid-glass')).toBe(false);
  });
  it('materializa o adaptador, o motor, as fontes e licenças juntos',()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-design-'));
    try{
      expect(approvedDesignContext(profile,7,tmp).join('\n')).toContain('ApprovedDesignRoot');
      const root=path.join(tmp,'contexto/templates-nivoo/liquid-glass');
      for(const name of ['approved-design.tsx','approved-profile.json','engine/nivoo.tsx','engine/LICENSE','fonts/fonts.css','fonts/ibm-plex-serif-400.ttf','fonts/ibm-plex-sans.ttf','fonts/ibm-plex-serif-OFL.txt'])expect(fs.existsSync(path.join(root,name))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(root,'approved-profile.json'),'utf8')).revision).toBe(7);
      expect(fs.existsSync(path.join(root,'fonts/inter.ttf'))).toBe(false);
      expect(fs.readdirSync(tmp)).toEqual(['contexto']);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  });
});
