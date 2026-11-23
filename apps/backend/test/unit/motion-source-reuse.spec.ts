import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetConfigCache } from '../../src/config';
import { WorkspaceService } from '../../src/storage/workspace.service';

describe('Reaproveitamento de fontes motion de trabalhos anteriores', () => {
  const anteriorEnv = process.env.NIVOO_WORKSPACES_ROOT;
  let raiz: string;
  let service: WorkspaceService;

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-motion-source-'));
    process.env.NIVOO_WORKSPACES_ROOT = raiz;
    resetConfigCache();
    service = new WorkspaceService();
  });
  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
    if (anteriorEnv === undefined) delete process.env.NIVOO_WORKSPACES_ROOT;
    else process.env.NIVOO_WORKSPACES_ROOT = anteriorEnv;
    resetConfigCache();
  });

  it('copia HTML/assets anteriores em contexto sem alterar fontes ou seguir symlinks', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const dirs = service.projectDirs('areas/design-video/projetos/teste');
    const fonte = path.join(dirs.worktrees, id, 'motion', 'black-v2');
    fs.mkdirSync(path.join(fonte, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(fonte, 'index.html'), '<html>original v2</html>');
    fs.writeFileSync(path.join(fonte, 'assets', 'logo.js'), 'export const logo = 1;');
    fs.symlinkSync('/etc/passwd', path.join(fonte, 'senhas.js'));
    const workdir = path.join(dirs.worktrees, '22222222-2222-4222-8222-222222222222');
    fs.mkdirSync(path.join(workdir, 'contexto'), { recursive: true });

    const resultado = service.copiarFontesMotionAnteriores(
      'areas/design-video/projetos/teste', [id], workdir,
    );
    const destino = path.join(workdir, 'contexto', 'fontes-anteriores', id.slice(0, 8), 'motion', 'black-v2');
    expect(resultado.arquivos).toBe(2);
    expect(resultado.trabalhos).toEqual([id.slice(0, 8)]);
    expect(fs.readFileSync(path.join(destino, 'index.html'), 'utf8')).toContain('original v2');
    expect(fs.existsSync(path.join(destino, 'assets', 'logo.js'))).toBe(true);
    expect(fs.existsSync(path.join(destino, 'senhas.js'))).toBe(false);
    expect(fs.readFileSync(path.join(fonte, 'index.html'), 'utf8')).toBe('<html>original v2</html>');
  });

  it('não copia outro worktree se o ID não for um identificador de job válido', () => {
    const workdir = fs.mkdtempSync(path.join(raiz, 'work-'));
    expect(service.copiarFontesMotionAnteriores('areas/teste/projetos/teste',
      ['../foo', '/etc', '..'], workdir).arquivos).toBe(0);
  });
});
