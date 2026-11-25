import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { liquidGlassComponents,liquidGlassComponentsContext } from '../../src/projects/liquid-glass-components';
import { liquidGlassCss } from '../../src/projects/liquid-glass-template';

describe('Biblioteca Liquid Glass',()=>{
  it('fornece seis padrões locais, estáveis e compatíveis com o CSS base',()=>{
    const lib=liquidGlassComponents();
    expect(lib.version).toBe(1);
    expect(lib.requires).toEqual({id:'liquid-glass',version:1});
    expect(lib.components.map(c=>c.id)).toEqual(['buttons','navigation','dialog','form','table','panels']);
    const css=lib.files.find(f=>f.name==='components.css')!.content;
    const snippets=JSON.parse(lib.files.find(f=>f.name==='components.json')!.content);
    for(const c of snippets){
      expect(c.markup).toBeTruthy();
      for(const name of c.classes)expect(css+liquidGlassCss()).toContain('.'+name);
    }
    expect(css).not.toMatch(/@import|url\s*\(|(?:^|\n)\s*(?:body|html|:root|\*)\s*\{/i);
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('forced-colors');
    expect(css).toContain('pointer:coarse');
    expect(css).not.toMatch(/\.nv-glass-dialog\)[^{]*\{[^}]*display\s*:/);
  });
  it('demonstra modal, filtro, cadastro e transparência sem serviço externo',()=>{
    const lib=liquidGlassComponents();
    const html=lib.files.find(f=>f.name==='components.html')!.content;
    const js=lib.files.find(f=>f.name==='components-demo.js')!.content;
    expect(html).toContain('href="liquid-glass.css"');
    expect(html).toContain('href="components.css"');
    expect(html).toContain('src="components-demo.js"');
    expect(html).toContain('Dados fictícios');
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-live="polite"');
    expect(js).toContain('dialog.showModal()');
    expect(js).toContain('row.insertCell().textContent = value');
    expect(js).toContain('applyFilter()');
    expect(js).not.toMatch(/innerHTML|fetch\s*\(|localStorage|sessionStorage|https?:\/\//);
    expect(()=>new Function(js)).not.toThrow();
  });
  it('entrega arquivos somente no contexto descartável',()=>{
    expect(liquidGlassComponentsContext()).toEqual([]);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-glass-components-'));
    try{
      const lines=liquidGlassComponentsContext(dir);
      expect(lines.join('\n')).toContain('components.md');
      for(const file of liquidGlassComponents().files)expect(fs.readFileSync(path.join(dir,'contexto','templates-nivoo','liquid-glass',file.name),'utf8')).toBe(file.content);
      expect(fs.existsSync(path.join(dir,'components.css'))).toBe(false);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
