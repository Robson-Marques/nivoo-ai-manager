import { adaptarBuildVite } from '../src/previa/previa-vite';
describe('Build Vite na prévia por caminho',()=>{
  const base='/previa/'+'a'.repeat(48)+'/';
  it('adapta exatamente o comando de instalação e build usado no software de teste',()=>{
    expect(adaptarBuildVite('npm ci --include=dev && npm run build','tsc --noEmit && vite build',base))
      .toBe('npm ci --include=dev && npm run build -- --base "'+base+'"');
  });
  it('preserva comandos personalizados e a prévia fora do modo caminho',()=>{
    expect(adaptarBuildVite('npm run build','vite build --base /custom/',base)).toBe('npm run build');
    expect(adaptarBuildVite('npm run build && npm run migrate','vite build',base)).toBe('npm run build && npm run migrate');
    expect(adaptarBuildVite('npm run build','vite build',undefined)).toBe('npm run build');
    expect(adaptarBuildVite('npm run build','next build',base)).toBe('npm run build');
  });
});
