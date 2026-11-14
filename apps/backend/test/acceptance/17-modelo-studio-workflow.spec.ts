/**
 * Modelo pronto "Software — Studio Workflow" (pacote em modelos-prontos/studio-workflow): já vem criado,
 * NIVOO-REGRAS.md vira "Como a IA deve funcionar" e o resto vira materiais, que chegam à IA em contexto/base.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACOTES_DIR } from '../../src/areas/area-templates';
import { ProjectProfileService } from '../../src/projects/project-profile.service';
import { createHarness, Harness, truncateAll } from '../support/harness';

describe('Modelo pronto Studio Workflow', () => {
  let h: Harness;
  const pacote = path.join(PACOTES_DIR, 'studio-workflow');
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
  });
  afterAll(() => h.close());

  it('vem instalado com as regras do pacote e todos os materiais; projeto nele recebe o perfil', async () => {
    const regras = fs.readFileSync(path.join(pacote, 'NIVOO-REGRAS.md'), 'utf8').trim();
    expect(regras.length).toBeLessThanOrEqual(8000);
    const m = (await h.http().get('/api/areas/studio-workflow').expect(200)).body;
    expect(m.name).toBe('Software — Studio Workflow');
    expect(m.instructions[m.instructions.length - 1].text).toBe(regras);
    const materiais = m.baseFiles.map((f: any) => f.path);
    expect(materiais).toContain('prompt-alinhamento.md');
    expect(materiais).toContain('doctrine/disciplines/testing.md');
    expect(materiais).not.toContain('NIVOO-REGRAS.md');
    expect(materiais).toHaveLength(18);
    // Toda referência "contexto/base/<arquivo>" das regras aponta para um material que existe.
    for (const ref of regras.match(/contexto\/base\/[\w./-]+\.md/g) ?? []) expect(materiais).toContain(ref.replace('contexto/base/', ''));
    // Também é oferecido como ponto de partida para novos modelos.
    expect((await h.http().get('/api/areas/templates')).body.map((t: any) => t.key)).toContain('studio-workflow');

    const p = (await h.http().post('/api/projects').send({ name: 'Loja', base: 'studio-workflow' }).expect(201)).body;
    const perfil = await h.app.get(ProjectProfileService).build(p.id);
    expect(perfil.text).toContain('O texto do plano É o Relatório de alinhamento');
    expect(perfil.text).toContain('contexto/base/prompt-alinhamento.md');
  });
});
