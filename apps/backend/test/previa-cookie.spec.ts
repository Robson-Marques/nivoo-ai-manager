import { cookieDaPrevia,caminhoDaPrevia } from '../src/previa/previa.service';
describe('Acesso da prévia pelo navegador',()=>{
  it('usa cookie HTTPS host-only compatível com iframes',()=>{
    const c=cookieDaPrevia('a'.repeat(48),true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=None; Secure; Partitioned');
    expect(c).not.toContain('Domain=');
  });
  it('preserva o acesso HTTP local',()=>{
    const c=cookieDaPrevia('a'.repeat(48),false);
    expect(c).toContain('SameSite=Lax');
    expect(c).not.toContain('Secure');
  });
  it('não permite redirecionamentos externos',()=>{
    expect(caminhoDaPrevia('//outro.example')).toBe('/');
    expect(caminhoDaPrevia('/pedidos?f=1')).toBe('/pedidos?f=1');
  });
});
