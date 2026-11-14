/**
 * INTEGRAÇÃO REAL — conversa (interface simples) com Claude Code de verdade (opt-in: NIVOO_RUN_CLI_INTEGRATION=1).
 *
 * Cenário (o mesmo fluxo da tela de chat):
 *  1. Modelo "Pizzaria" com uma pasta de padrões importada (regra da casa com código único CASA-PZ-9137
 *     e um CLAUDE.md, que deve chegar à IA renomeado, sem virar configuração).
 *  2. Projeto no modelo → mensagem do usuário → a IA real lê projeto + base e propõe um plano.
 *     O que o usuário disse vira memória do projeto automaticamente.
 *  3. Aprovação → job real (Claude Code) → conclusão SÓ pelo verificador → entra na pasta principal.
 *     O resultado segue a base do modelo (código da casa).
 *  4. Segunda mensagem: a IA enxerga o arquivo criado e a memória da conversa anterior.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { exportEvidence, REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const b64 = (t: string) => Buffer.from(t).toString('base64');

d('Conversa real: modelo com pasta de padrões → plano → trabalho → memória', () => {
  let h: Harness;
  beforeAll(async () => {
    delete process.env.NIVOO_CLAUDE_BIN;
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, 'claude-code-cli');
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
  });

  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(
      async () => {
        const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
        const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
        return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
      },
      400_000,
      3000,
    );

  it('a IA segue a pasta de padrões do modelo, trabalha com aprovação e lembra da conversa', async () => {
    const area = (await h.http().post('/api/areas').send({ name: 'Pizzaria real', template: 'imagem' }).expect(201)).body;
    await h
      .http()
      .post(`/api/areas/${area.slug}/base/import`)
      .send({
        files: [
          { path: 'regras-da-casa.md', contentBase64: b64('# Regras da casa\n\nToda peça de texto termina com a linha "Código da casa: CASA-PZ-9137".\nTom: alegre, sem gírias.\n') },
          { path: 'CLAUDE.md', contentBase64: b64('Padrões do estúdio: sempre leia regras-da-casa.md antes de escrever.\n') },
        ],
      })
      .expect(201);
    const p = (await h.http().post('/api/projects').send({ name: 'Instagram real', area: area.slug, description: 'Posts de Instagram da pizzaria do bairro.' }).expect(201)).body;
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;

    await h
      .http()
      .post(`/api/projects/${p.id}/conversations/${conv.id}/messages`)
      .send({
        content:
          'Quero o arquivo legenda-margherita.txt com a legenda de um post anunciando a pizza Margherita. ' +
          'Nosso público são famílias do bairro. Pode propor o plano direto, sem perguntas.',
      })
      .expect(201);
    const r1 = await resposta(p.id, conv.id, 1);
    expect(r1.status).toBe('PRONTA');
    expect(r1.kind).toBe('plano');
    const memoria1 = (await h.http().get(`/api/projects/${p.id}/memory`)).body.filter((m: any) => m.references?.origem === 'conversa');

    const c2 = (await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${r1.id}/approve`).send({ decidedBy: 'teste real' }).expect(201)).body;
    const jobId = c2.messages.find((m: any) => m.id === r1.id).jobId;
    const aprovacoes: string[] = [];
    const job = await waitFor(
      async () => {
        const x = (await h.http().get(`/api/projects/${p.id}/jobs/${jobId}`)).body;
        // A IA pode incluir um critério subjetivo (ex.: "o usuário aprova o tom"): aqui faz o papel do
        // botão "Pode seguir" da tela, registrando quem aprovou.
        for (const a of x.approvals.filter((y: any) => y.status === 'PENDENTE')) {
          aprovacoes.push(a.description);
          await h.http().post(`/api/approvals/${a.id}/decide`).send({ decision: 'APROVADO', decidedBy: 'teste real (conferido)' }).expect(201);
        }
        return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
      },
      1_200_000,
      5000,
    );
    const arquivo = path.join(p.workspacePath, 'repo', 'legenda-margherita.txt');
    const legenda = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null;

    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'Que arquivos o projeto já tem e qual é o nosso público? Responda em uma frase.' }).expect(201);
    const r2 = await resposta(p.id, conv.id, 2);

    const evid = await exportEvidence(h, jobId, 'real-06-conversa-modelo', {
      conversa: (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body.messages.map((m: any) => ({
        papel: m.role,
        tipo: m.kind,
        status: m.status,
        texto: m.content,
        plano: m.plan,
        custoUsd: Number(m.costUsd ?? 0),
        sessao: m.sessionId,
      })),
      memoriaDaConversa: memoria1.map((m: any) => ({ categoria: m.category, titulo: m.title, conteudo: m.content })),
      legenda,
      aprovacoesPedidasPelaIA: aprovacoes,
      mergeStatus: job.mergeStatus,
    });

    expect(job.status).toBe('CONCLUIDO');
    expect(job.mergeStatus).toBe('INCORPORADO');
    expect(legenda).toContain('CASA-PZ-9137'); // seguiu a pasta de padrões do modelo
    expect(memoria1.length).toBeGreaterThan(0); // o que foi dito virou memória
    expect(JSON.stringify(memoria1).toLowerCase()).toMatch(/fam[ií]lia/);
    expect(r2.status).toBe('PRONTA');
    expect(r2.content).toMatch(/legenda-margherita/);
    expect(r2.content.toLowerCase()).toMatch(/fam[ií]lia/);
    expect(evid.job.status).toBe('CONCLUIDO');
  }, 2_400_000);
});
