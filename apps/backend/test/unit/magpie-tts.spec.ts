import { magpieForm,roteiroFaladoNvidia,wavValido } from '../../src/providers/magpie-tts.service';
import { narracaoValida } from '../../src/jobs/workflow/media-options';
import { VOZ_PADRAO_NVIDIA,vozPadraoDoMotor } from '../../src/providers/vozes';
describe('NVIDIA Magpie TTS',()=>{
  it('validates the official multipart fields and keeps voice punctuation',()=>{
    const text=roteiroFaladoNvidia([{texto:'Vem experimentar esse sabor.',intencao:'chamada'},{texto:'Vai ficar de fora dessa',intencao:'pergunta'}]);
    expect(text).toBe('Vem experimentar esse sabor. Vai ficar de fora dessa?');
    const form=magpieForm(text,VOZ_PADRAO_NVIDIA);
    expect(form.get('language')).toBe('pt-BR');
    expect(form.get('voice')).toBe(VOZ_PADRAO_NVIDIA);
    expect(form.get('text')).toBe(text);
    expect(form.get('sample_rate_hz')).toBe('44100');
    expect(()=>magpieForm('Oi [pause:0.5s]',VOZ_PADRAO_NVIDIA)).toThrow();
    expect(()=>magpieForm('Oi','pf_dora')).toThrow();
  });
  it('validates the new motor and refuses mismatched voices',()=>{
    expect(vozPadraoDoMotor('nvidia')).toBe(VOZ_PADRAO_NVIDIA);
    expect(narracaoValida('voz',{texto:'Olá',motor:'nvidia'}).voz).toBe(VOZ_PADRAO_NVIDIA);
    expect(()=>narracaoValida('voz',{texto:'Olá',motor:'nvidia',voz:'pf_dora'})).toThrow();
  });
  it('rejects JSON or truncated WAV masquerading as audio',()=>{
    expect(wavValido(Buffer.from('{"error":"no audio"}'))).toBe(false);
    const wav=Buffer.alloc(46);
    wav.write('RIFF',0);wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(2,40);
    expect(wavValido(wav)).toBe(true);
    expect(wavValido(wav.subarray(0,45))).toBe(false);
  });
});
