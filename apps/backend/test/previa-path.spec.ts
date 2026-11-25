import { modoCaminho,bloquearApiDaPrevia } from '../src/previa/previa-path';
describe('Prévia no domínio do Nivoo',()=>{
  it('selects the viewer only for /previa',()=>{
    const antigo=process.env.NIVOO_PREVIA_URL;
    try{
      process.env.NIVOO_PREVIA_URL='/previa';
      expect(modoCaminho()).toBe(true);
      process.env.NIVOO_PREVIA_URL='https://previa.example.com';
      expect(modoCaminho()).toBe(false);
    }finally{if(antigo===undefined)delete process.env.NIVOO_PREVIA_URL;else process.env.NIVOO_PREVIA_URL=antigo;}
  });
  it('rejects opaque or cross-site requests to administrative API',()=>{
    expect(bloquearApiDaPrevia({headers:{origin:'null'}})).toBe(true);
    expect(bloquearApiDaPrevia({headers:{'sec-fetch-site':'cross-site'}})).toBe(true);
    expect(bloquearApiDaPrevia({headers:{'sec-fetch-site':'same-origin'}})).toBe(false);
  });
});
