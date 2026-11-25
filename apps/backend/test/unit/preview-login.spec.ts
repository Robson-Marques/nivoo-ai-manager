import {parsePreviewLogin,createPreviewLogin} from '../../src/previa/preview-login';
describe('Login descartável declarado pelo projeto',()=>{
  it('gera dados novos por prévia e usa as variáveis do contrato',()=>{
    const config=parsePreviewLogin(true)!;
    const a=createPreviewLogin(config),b=createPreviewLogin(config);
    expect(a.env.OPERATOR_USERNAME).toBe(a.credentials.usuario);
    expect(a.env.OPERATOR_PASSWORD).toBe(a.credentials.senha);
    expect(a.env.COOKIE_SECURE).toBe('false');
    expect(a.env.SESSION_SECRET).toHaveLength(64);
    expect(a.credentials.senha).not.toBe(b.credentials.senha);
    expect(a.env.SESSION_SECRET).not.toBe(b.env.SESSION_SECRET);
    expect(a.credentials).not.toHaveProperty('segredo');
  });
  it('preserva projetos sem contrato e rejeita mapeamentos inseguros',()=>{
    expect(parsePreviewLogin(undefined)).toBeUndefined();
    expect(()=>parsePreviewLogin({usuario:'LOGIN',senha:'DATABASE_URL',segredo:'SECRET'})).toThrow();
    expect(()=>parsePreviewLogin({usuario:'LOGIN',senha:'LOGIN',segredo:'SECRET'})).toThrow();
  });
});
