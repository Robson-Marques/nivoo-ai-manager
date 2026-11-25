import {verificationDiagnostic} from '../../src/worker/executor/verification-diagnostic';
describe('diagnóstico da conferência',()=>{
  it('preserva a asserção mesmo quando a saída termina com testes aprovados',()=>{
    const log=['AssertionError [ERR_ASSERTION]: Excluir: ação cortada na fatura','at conferirTelas (cartoes-vencimento.cjs:200:12)','[VersionHelper] git describe falhou: spawn /bin/sh ENOENT',...Array(183).fill('PASS teste'), 'Tests: 183 passed, 183 total'].join('\n');
    expect(verificationDiagnostic(log)).toBe('AssertionError [ERR_ASSERTION]: Excluir: ação cortada na fatura');
  });
  it('não trata avisos e resultados aprovados como falha',()=>{
    expect(verificationDiagnostic('npm warn deprecated\n[VersionHelper] Error: spawn /bin/sh ENOENT\nTests: 183 passed')).toBe('');
  });
  it('identifica erros reais de compilação e execução',()=>{
    expect(verificationDiagnostic('src/a.ts(2,3): error TS1005: expected')).toContain('TS1005');
    expect(verificationDiagnostic('TypeError: undefined')).toContain('TypeError');
  });
});
