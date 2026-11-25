import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DesignProfileStore } from '../src/design-studio/design-profile.store';
import { designCatalog } from '../src/design-studio/catalog';
import { defaultVisual, palettes } from '../src/design-studio/visual';

describe('Design Studio profile persistence',()=>{
  let root:string;
  let store:DesignProfileStore;
  const fields={title:'ERP',mode:'remodel',sourceId:'liqui',theme:'dark'};
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-design-'));store=new DesignProfileStore(root);});
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  it('persists profiles across store instances and updates revisions',()=>{
    const p=store.create(fields);
    expect(new DesignProfileStore(root).get(p.id)).toEqual(p);
    expect(store.update(p.id,{...fields,title:'ERP novo',revision:1}).revision).toBe(2);
    expect(()=>store.update(p.id,{...fields,revision:1})).toThrow();
    expect(store.list()[0].title).toBe('ERP novo');
  });
  it('rejects references, invalid modes and path traversal',()=>{
    expect(()=>store.create({...fields,sourceId:'liquid-glass-prompts'})).toThrow();
    expect(()=>store.create({...fields,mode:'unknown'})).toThrow();
    expect(()=>store.get('../outside')).toThrow();
  });
  it('persists visual tokens and rejects malformed color values',()=>{
    const p=store.create({...fields,visual:{...defaultVisual,colors:{...defaultVisual.colors,primary:'#ABCDEF'}}});
    expect(new DesignProfileStore(root).get(p.id).visual.colors.primary).toBe('#ABCDEF');
    expect(()=>store.update(p.id,{...fields,revision:1,visual:{...defaultVisual,colors:{...defaultVisual.colors,primary:'red'}}})).toThrow();
    expect(palettes.length).toBeGreaterThan(20);
  });
  it('does not represent a reference or uninstalled engine as a live renderer',()=>{
    expect(new Set(designCatalog.map(s=>s.id)).size).toBe(designCatalog.length);
    expect(designCatalog.every(s=>s.kind==='reference'?s.status==='reference':(s.status==='adapter-pending'||(s.status==='ready'&&!!s.adapter)))).toBe(true);
  });
});
