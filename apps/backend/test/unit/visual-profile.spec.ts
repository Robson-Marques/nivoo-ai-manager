import { parseVisualProfile,parseVisualProfileUpdate,visualProfileContext } from '../../src/projects/visual-profile';

describe('Perfil visual persistente',()=>{
  const guided={schemaVersion:1,mode:'guided',styleId:'liquid-glass',fonts:{heading:'inter',body:'manrope'},theme:'system',density:'balanced',usage:'both'};
  it('preserva escolhas sem inventar campos ou valores padrão',()=>{
    expect(parseVisualProfile(guided)).toEqual(guided);
    expect(parseVisualProfile({schemaVersion:1,mode:'guided',theme:'light'})).toEqual({schemaVersion:1,mode:'guided',theme:'light'});
    expect(parseVisualProfile({schemaVersion:1,mode:'delegated'})).toEqual({schemaVersion:1,mode:'delegated'});
    expect(parseVisualProfile(null)).toBeNull();
  });
  it('rejeita schema inválido, CSS, campos extras, IDs e enums inseguros',()=>{
    for(const v of [undefined,[],{},'x',{...guided,schemaVersion:2},{...guided,mode:'approved'},{...guided,styleId:'https://x.test'},{...guided,fonts:{body:'Inter; color:red'}},{...guided,fonts:{}},{...guided,fonts:{body:'inter',extra:'foo'}},{...guided,theme:'custom'},{...guided,density:1},{...guided,usage:'tv'},{...guided,css:'body{}'},{schemaVersion:1,mode:'guided'},JSON.parse('{"schemaVersion":1,"mode":"delegated","__proto__":{"styleId":"x"}}')]){
      expect(()=>parseVisualProfile(v)).toThrow();
    }
  });
  it('exige revisão explícita e distingue ausência de reset',()=>{
    expect(parseVisualProfileUpdate({expectedRevision:0,profile:guided})).toEqual({expectedRevision:0,profile:guided});
    expect(parseVisualProfileUpdate({expectedRevision:1,profile:null})).toEqual({expectedRevision:1,profile:null});
    for(const v of [{profile:null},{expectedRevision:-1,profile:null},{expectedRevision:1.5,profile:null},{expectedRevision:'1',profile:null},{expectedRevision:2147483647,profile:null},{expectedRevision:1},{expectedRevision:0,profile:guided,extra:true}])expect(()=>parseVisualProfileUpdate(v)).toThrow();
  });
  it('valida novos estilos contra o catálogo sem apagar perfis legados',()=>{
    const unknown={...guided,styleId:'legacy-style'};
    expect(parseVisualProfile(unknown)).toEqual(unknown);
    expect(()=>parseVisualProfileUpdate({expectedRevision:0,profile:unknown})).toThrow('Estilo visual não encontrado');
    expect(visualProfileContext(unknown,1).join('\n')).toContain('Estilo não disponível no catálogo atual');
    const explicit={...guided,styleId:'premium-dark',theme:'light'};
    expect(parseVisualProfileUpdate({expectedRevision:0,profile:explicit}).profile).toEqual(explicit);
  });
  it('compõe orientação enxuta, sem campos indefinidos e sem conteúdo não confiável',()=>{
    expect(visualProfileContext(null,0)).toEqual([]);
    const t=visualProfileContext(guided,2).join('\n');
    expect(t).toContain('revisão 2');
    expect(t).toContain('Estilo: liquid-glass');
    expect(t).toContain('Fonte de texto: manrope');
    expect(t).toContain('Direção do estilo Liquid Glass');
    expect(t).not.toContain('Direção do estilo Corporativo');
    expect(t).not.toContain('Paleta:');
    expect(t).not.toContain('undefined');
    expect(visualProfileContext({schemaVersion:1,mode:'delegated'},1).join('\n')).toContain('delegadas');
    expect(visualProfileContext({...guided,css:'INJECAO'},1).join('\n')).not.toContain('INJECAO');
  });
});
