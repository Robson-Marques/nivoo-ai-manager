import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// O script é Bash do servidor Debian. No CI/Linux validamos a regra executando o próprio código; no Windows a
// sintaxe é conferida separadamente pelo Git Bash durante o desenvolvimento.
const describeNoLinux = process.platform === 'win32' ? describe.skip : describe;

describeNoLinux('retenção dos backups do servidor', () => {
  it('preserva os dois conjuntos completos mais recentes e remove antigos, incompletos e temporários', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-backups-'));
    const helper = path.resolve(__dirname, '../../../../deploy/backup-retention.sh');
    const criar = (ts: string, completo = true) => {
      fs.writeFileSync(path.join(dir, `nivoo-db-${ts}.dump`), 'db');
      fs.writeFileSync(path.join(dir, `nivoo-data-${ts}.tar.gz`), 'data');
      if (completo) fs.writeFileSync(path.join(dir, `nivoo-env-${ts}`), 'env');
    };
    criar('20261115-100000');
    criar('20261116-100000');
    criar('20261117-100000');
    criar('20261118-100000', false);
    fs.writeFileSync(path.join(dir, '.nivoo-db-20261118-110000.dump.tmp'), 'parcial');
    fs.writeFileSync(path.join(dir, 'arquivo-do-administrador.txt'), 'não apagar');

    const r = spawnSync('bash', ['-c', 'set -euo pipefail; BACKUP_DIR="$1"; . "$2"; limpar_backups_antigos 2', 'teste', dir, helper], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'arquivo-do-administrador.txt',
      'nivoo-data-20261116-100000.tar.gz',
      'nivoo-data-20261117-100000.tar.gz',
      'nivoo-db-20261116-100000.dump',
      'nivoo-db-20261117-100000.dump',
      'nivoo-env-20261116-100000',
      'nivoo-env-20261117-100000',
    ]);
    expect(r.stdout).toMatch(/incompleto: 20261118-100000/);
    expect(r.stdout).toMatch(/antigo: 20261115-100000/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
