/**
 * Teste de ponta a ponta da interface (Playwright), pela tela, contra API + worker reais.
 * A IA é o stub TEST-ONLY do Claude (respostas fixas), para o teste ser determinístico:
 *   STUB_TMP=$(mktemp -d); mkdir -p $STUB_TMP/nivoo-cli-stub
 *   export TMPDIR=$STUB_TMP NIVOO_CLAUDE_BIN=$PWD/apps/backend/test/support/stubs/claude-stub.sh
 *   node apps/backend/dist/main.js & node apps/backend/dist/worker.js &
 *   STUB_TMP=$STUB_TMP SHOTS=/caminho node apps/web/e2e/chat-smoke.cjs
 * Com IA real, use apps/backend/test/integration/real-06 (não este script).
 *
 *  1. Contas de IA: Claude, ChatGPT e Gemini listados com o estado da conexão
 *  2. Modelos: novo modelo a partir de "Software", regras importadas de um PDF, pasta de materiais
 *  3. Novo projeto no modelo, com a IA escolhida; Ajustes: regras do projeto e conhecimento
 *  4. Conversa → "Posso fazer isto" → Fazer → conferência das regras → Pronto; memória e arquivos
 *  5. A IA recebeu o perfil do projeto (regras, materiais, conhecimento)
 *  6. Várias conversas: nova, arquivar, excluir; excluir o projeto
 *  7. Git: projeto trazido de um repositório (repositório local de teste; a API precisa de
 *     NIVOO_GIT_PERMITIR_LOCAL=1), aba Git com o estado, envio com tag
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = process.env.NIVOO_UI_URL ?? 'http://localhost:3000';
const ctl = path.join(process.env.STUB_TMP ?? os.tmpdir(), 'nivoo-cli-stub');
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });
const passo = (msg) => console.log(`  ok  ${msg}`);
const stamp = Date.now().toString(36);

function pdfCom(texto) {
  const conteudo = `BT /F1 14 Tf 10 50 Td (${texto}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const plano = {
  tipo: 'plano',
  texto: 'Entendi. Vou criar o cardápio do sistema.',
  job: {
    title: 'Cardápio',
    objective: 'Criar cardapio.md',
    steps: [{ key: 'c', title: 'Escrever o cardápio', instructions: "printf '# Cardápio\\n- Margherita\\n' > cardapio.md", verifyCommand: 'test -f cardapio.md' }],
    criteria: [{ key: 'a', description: 'cardápio existe', kind: 'FILE_EXISTS', config: { path: 'cardapio.md' } }],
  },
  memoria: [
    { tipo: 'PREFERENCIA', titulo: 'Tom das peças', conteudo: 'Tom alegre e familiar.' },
    { tipo: 'FATO', titulo: 'Sabor principal', conteudo: 'A pizza mais vendida é a Margherita.' },
  ],
};

(async () => {
  fs.mkdirSync(ctl, { recursive: true });
  for (const f of ['mode', 'resposta.txt', 'conforme', 'prompt.txt', 'prompt-revisor.txt', 'args.txt']) fs.rmSync(path.join(ctl, f), { force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-smoke-'));
  const pdf = path.join(tmp, 'regras-erp.pdf');
  fs.writeFileSync(pdf, pdfCom(`Regra do PDF ERP-${stamp}`));
  const pasta = path.join(tmp, 'PADROES');
  for (const [f, c] of Object.entries({
    'README.md': '# Padrões\nFluxo: briefing, arquitetura, identidade, código',
    'padroes/identidade-visual.md': 'Paleta #FF6600',
    '.claude/agents/arquiteto.md': 'agente arquiteto',
    'node_modules/x/a.js': 'lixo',
  })) {
    fs.mkdirSync(path.dirname(path.join(pasta, f)), { recursive: true });
    fs.writeFileSync(path.join(pasta, f), c);
  }
  const conhecimento = path.join(tmp, 'precos.md');
  fs.writeFileSync(conhecimento, `Margherita custa R$ 45. CONH-${stamp}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  try {
    // 1. Contas de IA
    await page.goto(`${base}/contas`);
    for (const nome of ['Claude', 'ChatGPT', 'Gemini']) await page.getByRole('heading', { name: nome, exact: true }).waitFor();
    await page.getByText('Chave de API').first().waitFor();
    await page.waitForTimeout(500);
    await shot(page, '1-contas');
    passo('Contas de IA: Claude, ChatGPT e Gemini');

    // 2. Modelos
    await page.getByRole('link', { name: 'Modelos' }).click();
    await page.getByRole('button', { name: '+ Novo modelo' }).click();
    const modelo = `Sistemas ERP ${stamp}`;
    await page.getByLabel('Nome do modelo').fill(modelo);
    await page.getByRole('button', { name: /^Software/ }).click();
    await page.getByLabel(/Como a IA deve funcionar/).fill(`Você é engenheiro de sistemas ERP. Código MOD-${stamp}.`);
    await shot(page, '2-novo-modelo');
    await page.getByRole('button', { name: 'Criar modelo' }).click();
    await page.getByRole('heading', { name: modelo }).waitFor();
    const editor = page.locator('.editor-regras').first();
    await editor.locator('input[type=file]').setInputFiles(pdf);
    await page.getByText(/colocado abaixo/).waitFor();
    const regras = await editor.locator('textarea').inputValue();
    if (!regras.includes(`ERP-${stamp}`) || !regras.includes(`MOD-${stamp}`)) throw new Error('texto do PDF não entrou nas regras do modelo');
    await editor.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText(/Salvo\. A versão anterior/).waitFor();
    await page.locator('.materiais input[type=file]').nth(1).setInputFiles(pasta);
    await page.getByText(/3 arquivo\(s\) guardados/).waitFor();
    await shot(page, '3-editar-modelo');
    passo('modelo criado: regras importadas de PDF e pasta de materiais (node_modules ignorada)');

    // 3. Novo projeto e ajustes
    await page.getByRole('button', { name: '+ Novo projeto' }).click();
    const nome = `Pizzaria ${stamp}`;
    await page.getByLabel('Nome do projeto').fill(nome);
    await page.getByLabel(/Sobre o que/).fill('Sistema de pedidos da pizzaria do bairro.');
    await page.locator('.modal .tipo', { hasText: modelo }).click();
    await page.locator('.modal .tipo', { hasText: 'Claude (conta)' }).click();
    await shot(page, '4-novo-projeto');
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await page.getByRole('heading', { name: nome }).waitFor();
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    const regrasProjeto = page.locator('.ajustes .editor-regras');
    await regrasProjeto.locator('textarea').fill(`Só trate de pedidos e cardápio. Código PROJ-${stamp}.`);
    await regrasProjeto.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText(/Salvo\. A versão anterior/).waitFor();
    await page.locator('.ajustes .materiais input[type=file]').first().setInputFiles(conhecimento);
    await page.getByText(/1 arquivo\(s\) guardados/).waitFor();
    await shot(page, '5-ajustes');
    passo('projeto criado no modelo, com regras próprias e conhecimento');

    // 4. Conversa → plano → Fazer → conferência → pronto
    fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify(plano) + '\n```');
    await page.getByRole('button', { name: 'O que o projeto lembra' }).click();
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Quero o cardápio com Margherita, tom alegre');
    await page.keyboard.press('Enter');
    await page.getByText('Posso fazer isto:').waitFor({ timeout: 60000 });
    const promptConversa = fs.readFileSync(path.join(ctl, 'prompt.txt'), 'utf8');
    for (const c of [`MOD-${stamp}`, `ERP-${stamp}`, `PROJ-${stamp}`, 'contexto/base/padroes/identidade-visual.md', 'contexto/base/_claude/agents/arquiteto.md', 'contexto/conhecimento/precos.md']) {
      if (!promptConversa.includes(c)) throw new Error(`a IA da conversa não recebeu: ${c}`);
    }
    if (promptConversa.includes('node_modules')) throw new Error('node_modules chegou à IA');
    await shot(page, '6-plano');
    passo('a IA recebeu o perfil do projeto e propôs um plano');
    fs.writeFileSync(path.join(ctl, 'mode'), 'bash'); // a "IA" executa a etapa do plano
    await page.getByRole('button', { name: 'Fazer', exact: true }).click();
    await page.getByText(/Pronto\. O resultado/).waitFor({ timeout: 90000 });
    if (!fs.existsSync(path.join(ctl, 'prompt-revisor.txt'))) throw new Error('a conferência das regras não rodou');
    await page.getByText('Tom das peças', { exact: true }).waitFor({ timeout: 15000 });
    await shot(page, '7-pronto-memoria');
    passo('trabalho feito, conferido contra as regras e incorporado; memória automática visível');
    await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
    await page.getByRole('button', { name: 'cardapio.md' }).click();
    await page.getByText('Margherita').last().waitFor();
    await shot(page, '8-arquivo');
    await page.getByRole('button', { name: 'Fechar' }).click();
    passo('arquivo criado aparece na pasta do projeto');

    // 5. Várias conversas: nova, arquivar, excluir
    const primeira = page.locator('.conversa-item.on');
    await primeira.waitFor();
    if (!(await primeira.innerText()).includes('Quero o cardápio')) throw new Error('a conversa não ganhou o título da primeira mensagem');
    await page.getByRole('button', { name: '+ Nova conversa' }).click();
    await page.getByText(/Nova conversa\. A IA já conhece/).waitFor();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).hover();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).getByRole('button', { name: /Opções/ }).click();
    await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'conversas arquivadas' }).click();
    const arquivada = page.locator('.conversa-item.arquivada', { hasText: 'Quero o cardápio' });
    await arquivada.waitFor();
    await shot(page, '9-conversas-arquivadas');
    await arquivada.hover();
    await arquivada.getByRole('button', { name: /Opções/ }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await arquivada.waitFor({ state: 'detached' });
    passo('nova conversa, conversa arquivada e excluída');

    // 6. Excluir o projeto
    page.once('dialog', (d) => d.accept(nome));
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir este projeto' }).click();
    await page.locator('.proj', { hasText: nome }).waitFor({ state: 'detached' });
    passo('projeto excluído');

    // 7. Git: trazer um projeto existente e enviar com tag
    const remoto = path.join(tmp, 'remoto.git');
    const semente = path.join(tmp, 'semente');
    const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim();
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
    fs.mkdirSync(semente);
    g(semente, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(semente, 'README.md'), '# Loja existente\n');
    fs.writeFileSync(path.join(semente, 'CLAUDE.md'), `Regra do repositório GIT-${stamp}\n`);
    g(semente, 'add', '-A');
    g(semente, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'inicio');
    g(semente, 'push', '-q', remoto, 'main');
    await page.goto(`${base}/contas`);
    await page.getByRole('heading', { name: 'Git (GitHub e GitLab)' }).waitFor();
    await page.getByRole('button', { name: '+ Novo projeto' }).click();
    const nomeGit = `Loja ${stamp}`;
    await page.getByLabel('Nome do projeto').fill(nomeGit);
    await page.locator('.modal .tipo', { hasText: 'Trazer de um repositório Git' }).click();
    await page.getByLabel('Endereço do repositório').fill(remoto);
    await shot(page, '10-novo-projeto-git');
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await page.getByRole('heading', { name: nomeGit }).waitFor();
    await page.getByRole('button', { name: 'Git', exact: true }).click();
    await page.getByText(/0 commit\(s\) para enviar/).waitFor();
    await page.getByText('inicio').waitFor();
    await page.getByPlaceholder(/Versão\/tag/).fill('v0.1.0');
    await page.getByRole('button', { name: 'Enviar para o Git' }).click();
    await page.getByText('Enviado ao Git com a tag v0.1.0.').waitFor();
    await shot(page, '11-git-do-projeto');
    if (g(remoto, 'tag') !== 'v0.1.0') throw new Error('tag não chegou ao repositório');
    page.once('dialog', (d) => d.accept(nomeGit));
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir este projeto' }).click();
    await page.locator('.proj', { hasText: nomeGit }).waitFor({ state: 'detached' });
    passo('projeto trazido do Git, estado na aba Git, enviado com tag');
    if (erros.length) throw new Error(`erros no navegador: ${erros.join('; ')}`);
    console.log('CHAT-SMOKE OK');
  } catch (e) {
    await shot(page, 'erro');
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of ['mode', 'resposta.txt']) fs.rmSync(path.join(ctl, f), { force: true });
  }
})();
