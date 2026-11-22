import { parseHyperFramesCatalog, validateCatalogSearch } from '../src/video-studio/hyperframes-catalog';

describe('HyperFrames official registry discovery (read-only)',()=>{
  it('accepts plain English intent only, never executable input',()=>{
    expect(validateCatalogSearch('  animated    title  ')).toBe('animated title');
    expect(()=>validateCatalogSearch('')).toThrow();
    expect(()=>validateCatalogSearch('$(curl example.com)')).toThrow();
    expect(()=>validateCatalogSearch('a'.repeat(91))).toThrow();
    expect(()=>validateCatalogSearch({query:'transition'})).toThrow();
  });

  it('normalizes the upstream JSON envelope and strips untrusted fields',()=>{
    const upstream=JSON.stringify({
      query:'reveal a headline',tier:'words',total:2,results:[
        {name:'cinematic-zoom',type:'hyperframes:block',title:'Cinematic Zoom',
          description:'Zoom blur reveal',tags:['transition','shader'],
          files:[{path:'evil.js'}],preview:{video:'https://example.com'},
        },
        {name:'blur-in',type:'hyperframes:component',title:'Blur In',
          description:'Soft title intro',tags:['text','<script>']},
      ],
    });
    const out=parseHyperFramesCatalog(upstream,'reveal a headline');
    expect(out.items).toEqual([
      {name:'cinematic-zoom',type:'block',title:'Cinematic Zoom',description:'Zoom blur reveal',
        tags:['transition','shader'],status:'reference-only'},
      {name:'blur-in',type:'component',title:'Blur In',description:'Soft title intro',
        tags:['text'],status:'reference-only'},
    ]);
    expect(JSON.stringify(out)).not.toContain('evil.js');
    expect(JSON.stringify(out)).not.toContain('https://');
    expect(out.tier).toBe('words');
  });

  it('ignores invalid registry entries without adding executable data',()=>{
    const input=JSON.stringify({results:[
      {name:'../../secrets',type:'hyperframes:block',title:'X',description:'X'},
      {name:'valid-block',type:'hyperframes:example',title:'Y',description:'Y'},
      {name:'valid-block',type:'hyperframes:block',title:'Valid',description:'Valid'},
      {name:'valid-block',type:'hyperframes:block',title:'Duplicate',description:'Duplicate'},
    ]});
    expect(parseHyperFramesCatalog(input,'reveal').items.map(x=>x.name)).toEqual(['valid-block']);
    expect(()=>parseHyperFramesCatalog('not-json','x')).toThrow('JSON');
    expect(()=>parseHyperFramesCatalog(JSON.stringify({results:'invalid'}),'x')).toThrow('estruturados');
  });

  it('bounds metadata even if the external registry contains long descriptions',()=>{
    const results=Array.from({length:50},(_,index)=>({
      name:'item-'+index,type:'hyperframes:block',title:'A'.repeat(400),
      description:'B'.repeat(500),tags:['transition'],
    }));
    const out=parseHyperFramesCatalog(JSON.stringify({results}),'transition');
    expect(out.items).toHaveLength(24);
    expect(out.items[0].title).toHaveLength(130);
    expect(out.items[0].description).toHaveLength(350);
  });
});
