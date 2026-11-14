/**
 * Teste de ponta a ponta da INTERFACE SIMPLES (chat + modelos), pela tela, contra API + worker reais.
 * A IA da conversa é o stub TEST-ONLY em modo "texto" (resposta fixa), para o teste ser determinístico:
 *   STUB_TMP=$(mktemp -d); mkdir -p $STUB_TMP/nivoo-cli-stub
 *   TMPDIR=$STUB_TMP NIVOO_CLAUDE_BIN=$PWD/apps/backend/test/support/stubs/claude-stub.sh node apps/backend/dist/main.js &
 *   TMPDIR=$STUB_TMP NIVOO_CLAUDE_BIN=... node apps/backend/dist/worker.js &
 *   STUB_TMP=$STUB_TMP SHOTS=/caminho node apps/web/e2e/chat-smoke.cjs
 * Com a IA real, use test/integration/real-06 (não este script).
 *
 *  1. Novo projeto (nome, sobre, tipo) → chat → plano "Posso fazer isto" → Fazer → Pronto
 *  2. Memória automática aparece no painel; arquivo criado aparece em Arquivos e abre
 *  3. Modelos: novo modelo com pasta de padrões (node_modules ignorada) → projeto no modelo → a IA recebe a base
 */
const { chromium } = require('playwright');
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

const plano = {
  tipo: 'plano',
  texto: 'Entendi. Vou criar o guia do cardápio com as pizzas que você citou.',
  job: {
    title: 'Guia do cardápio',
    objective: 'Criar cardapio.md',
    defaultProvider: 'local-shell',
    steps: [{ key: 'c', title: 'Escrever o cardápio', instructions: "printf '# Cardápio\\n- Margherita\\n' > cardapio.md" }],
    criteria: [{ key: 'a', description: 'cardapio existe', kind: 'FILE_EXISTS', config: { path: 'cardapio.md' } }],
  },
  memoria: [
    { tipo: 'PREFERENCIA', titulo: 'Tom das peças', conteudo: 'Tom alegre e familiar.' },
    { tipo: 'FATO', titulo: 'Sabor principal', conteudo: 'A pizza mais vendida é a Margherita.' },
  ],
};

(async () => {
  fs.mkdirSync(ctl, { recursive: true });
  fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
  fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify(plano) + '\n```');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'padroes-'));
  const raiz = path.join(pasta, 'STUDIO-WORKFLOW');
  for (const [f, c] of Object.entries({
    'README.md': '# Studio\nFluxo: briefing → arquitetura → identidade → código',
    'padroes/identidade-visual.md': 'Paleta #FF6600',
    '.claude/agents/arquiteto.md': 'agente arquiteto',
    'node_modules/x/a.js': 'lixo',
  })) {
    fs.mkdirSync(path.dirname(path.join(raiz, f)), { recursive: true });
    fs.writeFileSync(path.join(raiz, f), c);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  page.on('dialog', (d) => d.accept());
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole('button', { name: '+ Novo projeto' }).first().click();
    const nome = `Pizzaria ${stamp}`;
    await page.getByLabel('Nome do projeto').fill(nome);
    await page.getByLabel(/Sobre o que/).fill('Peças para o Instagram da pizzaria do bairro.');
    await page.getByRole('button', { name: /^Imagem/ }).click();
    await shot(page, 'chat-1-novo-projeto');
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await page.getByRole('heading', { name: nome }).waitFor();
    passo('projeto criado pelo chat (tipo Imagem)');

    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Quero um cardápio com Margherita, tom alegre');
    await page.keyboard.press('Enter');
    await page.getByText('Posso fazer isto:').waitFor({ timeout: 60000 });
    await shot(page, 'chat-2-plano');
    passo('a IA respondeu com um plano para aprovar');
    await page.getByRole('button', { name: 'Fazer', exact: true }).click();
    await page.getByText(/Pronto\. O resultado/).waitFor({ timeout: 90000 });
    await page.getByText('Tom das peças', { exact: true }).waitFor({ timeout: 15000 });
    await shot(page, 'chat-3-pronto-memoria');
    passo('trabalho concluído e memória automática visível');
    await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
    await page.getByRole('button', { name: 'cardapio.md' }).click();
    await page.getByText('Margherita').last().waitFor();
    await shot(page, 'chat-4-arquivo');
    await page.getByRole('button', { name: 'Fechar' }).click();
    passo('arquivo criado aparece na pasta do projeto');

    await page.getByRole('link', { name: /Modelos/ }).click();
    await page.getByRole('button', { name: '+ Novo modelo' }).click();
    const modelo = `Studio ${stamp}`;
    await page.getByLabel('Nome do modelo').fill(modelo);
    await page.getByLabel(/Regras do modelo/).fill('Siga sempre o fluxo e a identidade visual da pasta de padrões.');
    await page.locator('.modal input[type=file]').setInputFiles(raiz);
    await page.getByRole('button', { name: 'Criar modelo' }).click();
    const card = page.locator('section.modelo', { hasText: modelo });
    await card.getByText(/3 arquivo\(s\) de padrões/).waitFor();
    await shot(page, 'chat-5-modelos');
    passo('modelo criado com a pasta de padrões (node_modules ignorada)');

    await page.getByRole('button', { name: '+ Novo projeto' }).first().click();
    await page.getByLabel('Nome do projeto').fill(`Site ${stamp}`);
    await page.getByRole('button', { name: new RegExp(modelo) }).click();
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await page.getByRole('heading', { name: `Site ${stamp}` }).waitFor();
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Monte a página inicial');
    await page.keyboard.press('Enter');
    await page.getByText('Posso fazer isto:').waitFor({ timeout: 60000 });
    const prompt = fs.readFileSync(path.join(ctl, 'prompt.txt'), 'utf8');
    for (const f of ['area/README.md', 'area/padroes/identidade-visual.md', 'area/_claude/agents/arquiteto.md']) {
      if (!prompt.includes(f)) throw new Error(`a IA não recebeu ${f}`);
    }
    if (prompt.includes('node_modules')) throw new Error('node_modules chegou à IA');
    passo('projeto do modelo: a IA recebeu a pasta de padrões');
    if (erros.length) throw new Error(`erros no navegador: ${erros.join('; ')}`);
    console.log('CHAT-SMOKE OK');
  } catch (e) {
    await shot(page, 'chat-erro');
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
})();
