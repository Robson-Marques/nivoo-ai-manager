import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { liquidGlassCss,liquidGlassTemplate,liquidGlassTemplateContext } from '../../src/projects/liquid-glass-template';
import { VISUAL_PALETTES,VISUAL_DENSITIES,STYLE_FOUNDATIONS } from '../../src/projects/visual-token-catalog';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Template Liquid Glass',()=>{
  it('gera CSS determinístico dos tokens, com fallback e escopo opt-in',()=>{
    const css=liquidGlassCss();
    expect(css).toBe(liquidGlassCss());
    expect(css).not.toMatch(/@import|url\s*\(/i);
    for(const p of VISUAL_PALETTES){
      expect(css).toContain('[data-palette="'+p.id+'"]');
      expect(css).toContain('[data-palette="'+p.id+'"][data-theme="dark"]');
      expect(css).toContain('[data-palette="'+p.id+'"][data-theme="system"]');
      for(const t of [p.light,p.dark])for(const color of Object.values(t))expect(css).toContain(color);
    }
    for(const d of VISUAL_DENSITIES){
      expect(css).toContain('[data-density="'+d.id+'"]');
      expect(css).toContain('--nv-glass-control-height: '+d.controlMinHeight+'px');
      expect(css).toContain('--nv-glass-touch-height: '+d.touchMinHeight+'px');
    }
    const f=STYLE_FOUNDATIONS.find(x=>x.styleId==='liquid-glass')!;
    expect(css).toContain('--nv-glass-radius-panel: '+f.radius.panel+'px');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('@supports');
    expect(css).toContain('-webkit-backdrop-filter: blur(12px)');
    expect(css).toContain('data-transparency="opaque"');
    expect(css).toContain('prefers-reduced-transparency');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('forced-colors: active');
    expect(css.indexOf('background: var(--nv-glass-surface-raised)')).toBeLessThan(css.indexOf('@supports'));
    expect(css.indexOf('data-transparency="opaque"')).toBeGreaterThan(css.indexOf('@supports'));
    expect(css).toMatch(/\.nv-glass-content\)\s*\{[^}]*background: var\(--nv-glass-surface\)/);
    expect(css).not.toMatch(/(?:^|\n)\s*(?:body|html|:root|\*)\s*\{/);
  });
  it('oferece pacote sem recursos remotos e sem afirmar refração real',()=>{
    const p=liquidGlassTemplate();
    expect(p.files.map(f=>f.name)).toEqual(['liquid-glass.css','README.md','example.html']);
    expect(p.files[0].content).toBe(liquidGlassCss());
    expect(p.files[1].content).toContain('não há refração óptica real');
    expect(p.files[2].content).toContain('href="liquid-glass.css"');
    expect(p.files[1].content).toContain('O exemplo usa ocean-blue/system/');
    expect(p.files[2].content).toContain('data-palette="ocean-blue"');
    expect(p.files[2].content).toContain('radial-gradient(');
    expect(p.files[2].content).not.toMatch(/https?:\/\/|<script/i);
    expect(liquidGlassTemplateContext()).toEqual([]);
  });
  it('materializa somente na sessão selecionada, sem editar arquivos do projeto',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-glass-template-'));
    try{
      fs.writeFileSync(path.join(dir,'original.css'),'intacto');
      const args={phase:'execution' as const,media:false,software:true};
      const target=path.join(dir,'contexto','templates-nivoo','liquid-glass');
      const text='Corrigir endpoint';
      softwareEngineeringSections(selectSkills({...args,text,visualStyleId:'liquid-glass'}),{phase:'execution',text,worktree:dir,testDbConfigured:()=>false});
      expect(fs.existsSync(target)).toBe(false);
      const ui='Criar dashboard Liquid Glass';
      const sections=softwareEngineeringSections(selectSkills({...args,text:ui}),{phase:'execution',text:ui,worktree:dir,testDbConfigured:()=>false});
      expect(sections.find(s=>s.key==='engenharia-liquid-glass')?.lines.join('\n')).toContain('contexto/templates-nivoo/liquid-glass');
      expect(fs.readFileSync(path.join(target,'liquid-glass.css'),'utf8')).toBe(liquidGlassCss());
      expect(fs.readdirSync(target).sort()).toEqual(['README.md','components-demo.js','components.css','components.html','components.json','components.md','example.html','liquid-glass.css']);
      expect(fs.readFileSync(path.join(dir,'original.css'),'utf8')).toBe('intacto');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
