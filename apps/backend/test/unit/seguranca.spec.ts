/** Testes unitários de segurança: política, PathGuard, ambiente mínimo e hash de repetição. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv } from '../../src/common/exec';
import { normalizedOutputHash } from '../../src/common/hash';
import { resolveInside } from '../../src/common/path-guard';
import { evaluatePolicy } from '../../src/security/policy';

describe('Política de execução', () => {
  it.each([
    ['rm -rf build', true],
    ['git push --force origin x', true],
    ['git push origin main', true],
    ['git reset --hard HEAD~1', true],
    ['psql -c "DROP TABLE trades"', true],
    ['python backtest.py --janela 20', false],
    ['git commit -m ok', false],
  ])('%s → requer aprovação=%s', (cmd, expected) => {
    expect(evaluatePolicy(cmd).requiresApproval).toBe(expected);
  });

  it.each(['mt5.order_send(request)', 'enviar ordem de compra', 'operar em conta real', 'broker api login', 'send_order(WIN, 1)'])(
    '%s → proibido',
    (cmd) => {
      const v = evaluatePolicy(cmd);
      expect(v.forbidden).toBe(true);
      expect(v.allowed).toBe(false);
    },
  );
});

describe('PathGuard', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  fs.mkdirSync(path.join(root, 'a'));
  it('aceita caminhos internos e recusa escapes', () => {
    expect(resolveInside(root, 'a/x.csv')).toBe(path.join(fs.realpathSync(root), 'a', 'x.csv'));
    expect(() => resolveInside(root, '../x')).toThrow(/fora do diretório/);
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/absoluto/);
    fs.symlinkSync('/etc', path.join(root, 'a', 'etc'));
    expect(() => resolveInside(root, 'a/etc/passwd')).toThrow(/fora do diretório/);
  });
});

describe('Ambiente mínimo de processos filhos', () => {
  it('não repassa segredos do backend', () => {
    const saved = { ...process.env };
    process.env.DATABASE_URL = 'postgres://segredo';
    process.env.ANTHROPIC_API_KEY = 'sk-segredo';
    const env = minimalEnv({ NIVOO_JOB_ID: 'x' });
    process.env = saved;
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.NIVOO_JOB_ID).toBe('x');
    expect(env.PATH).toBeDefined();
  });
});

describe('Hash de repetição', () => {
  it('ignora timestamps e durações voláteis', () => {
    const a = normalizedOutputHash('erro em 2026-10-27T10:00:01.123Z após 120ms', 'exit 1');
    const b = normalizedOutputHash('erro em 2026-10-27T11:22:33.000Z após 87ms', 'exit 1');
    expect(a).toBe(b);
    expect(normalizedOutputHash('erro A', 'exit 1')).not.toBe(normalizedOutputHash('erro B', 'exit 1'));
  });
});
