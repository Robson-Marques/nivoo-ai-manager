import { activeWord, karaokeAss, validWords } from '../../src/video-studio/caption-timing';

describe('Nivoo Studio — legendas cinéticas',()=>{
  const caption={
    text:'Organize sua planilha',start:1.0,end:2.8,
    words:[
      {text:'Organize',start:1.1,end:1.55},
      {text:'sua',start:1.61,end:1.83},
      {text:'planilha',start:1.95,end:2.65},
    ]
  };
  it('preserva timestamps reais por palavra e o destaque acompanha a fala',()=>{
    expect(validWords(caption)).toBe(true);
    expect(activeWord(caption,1.2)).toBe(0);
    expect(activeWord(caption,1.7)).toBe(1);
    expect(activeWord(caption,2.2)).toBe(2);
    expect(activeWord(caption,1.9)).toBe(-1);
  });
  it('constrói ASS karaoke determinístico sem gerar código',()=>{
    const result=karaokeAss(caption,s=>s);
    expect(result).toContain('Organize');
    expect(result).toContain('{\\kf45}');
    expect(result).toContain('{\\kf22}');
    expect(result).toContain('planilha');
  });
  it('recusa tempo não finito, palavras fora da legenda e sequência invertida',()=>{
    expect(validWords({...caption,words:[{text:'x',start:2,end:1.5}]})).toBe(false);
    expect(validWords({...caption,words:[{text:'x',start:Infinity,end:2}]})).toBe(false);
    expect(validWords({...caption,words:[{text:'x',start:.2,end:.6}]})).toBe(false);
    expect(validWords({...caption,words:[{text:'x',start:1,end:1.2},{text:'y',start:1,end:1.1}]})).toBe(false);
  });
  it('não exige karaoke para legendas manuais antigas',()=>{
    expect(activeWord({text:'Manual',start:0,end:1},.5)).toBe(-1);
    expect(karaokeAss({text:'Manual',start:0,end:1},s=>s)).toBeNull();
  });
});
