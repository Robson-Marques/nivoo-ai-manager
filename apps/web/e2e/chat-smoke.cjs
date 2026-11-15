/**
 * Teste de ponta a ponta da interface (Playwright), pela tela, contra API + worker reais.
 * A IA é o stub TEST-ONLY do Claude (respostas fixas), para o teste ser determinístico:
 *   STUB_TMP=$(mktemp -d); mkdir -p $STUB_TMP/nivoo-cli-stub
 *   export TMPDIR=$STUB_TMP NIVOO_CLAUDE_BIN=$PWD/apps/backend/test/support/stubs/claude-stub.sh
 *   node apps/backend/dist/main.js & node apps/backend/dist/worker.js &
 *   STUB_TMP=$STUB_TMP SHOTS=/caminho node apps/web/e2e/chat-smoke.cjs
 * Com IA real, use apps/backend/test/integration/real-06 (não este script).
 *
 *  1. Conexões: lista com o estado; "+ Nova" cria uma SEGUNDA conta do mesmo tipo com nome próprio
 *     (Claude API 1 e Claude API 2), cada uma com a sua chave; renomear, padrão, excluir
 *  2. Modelos: o pronto "Software — Studio Workflow" já instalado; novo modelo a partir de "Software", regras importadas de um PDF, pasta de materiais
 *  3. Novo projeto no modelo, com a IA escolhida; Ajustes: regras do projeto e conhecimento
 *  4. Conversa → "Posso fazer isto" → Fazer → conferência das regras → Pronto; memória e arquivos
 *  5. A IA recebeu o perfil do projeto (regras, materiais, conhecimento)
 *  6. Várias conversas: nova, arquivar, excluir; anexos no chat (imagem e Word); excluir o projeto
 *  7. Git: projeto trazido de um repositório (repositório local de teste; a API precisa de
 *     NIVOO_GIT_PERMITIR_LOCAL=1), aba Git com o estado, envio com tag
 *  8. Conta GitLab (servidor simulado aqui: API /api/v4 que cria repositórios locais), projeto "do zero +
 *     repositório novo" num grupo, e escolher um repositório da lista ao trazer um projeto
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
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
    steps: [{ key: 'c', title: 'Escrever o cardápio', instructions: "sleep 6; printf '# Cardápio\\n- Margherita\\n' > cardapio.md", verifyCommand: 'test -f cardapio.md' }],
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
    // 1. Conexões: duas contas do mesmo tipo, cada uma com nome e chave próprios
    await page.goto(`${base}/contas`);
    await page.getByRole('heading', { name: 'Conexões', exact: true }).waitFor();
    await page.locator('.conexao', { hasText: 'Claude (conta)' }).getByText('Conectado', { exact: true }).waitFor();
    for (const [n, chave] of [[`Claude API 1 ${stamp}`, 'sk-ant-api03-SMOKE-UM-0123456789'], [`Claude API 2 ${stamp}`, null]]) {
      await page.getByRole('button', { name: 'Nova', exact: true }).click();
      await page.locator('.tipo-conexao', { hasText: 'Claude — chave de API' }).click();
      await page.getByLabel('Nome da conexão').fill(n);
      if (chave) await page.getByLabel('Chave de API').fill(chave);
      await page.getByRole('button', { name: 'Criar conexão' }).click();
      await page.locator('.conexao', { hasText: n }).waitFor();
    }
    await page.locator('.conexao', { hasText: `Claude API 1 ${stamp}` }).getByText('Conectado', { exact: true }).waitFor();
    const segunda = page.locator('.conexao', { hasText: `Claude API 2 ${stamp}` });
    await segunda.getByText('Não conectado', { exact: true }).waitFor(); // não herda a chave da primeira
    await segunda.getByPlaceholder(/Cole a chave de API/).fill('sk-ant-api03-SMOKE-DOIS-0123456789');
    await segunda.getByRole('button', { name: 'Salvar chave' }).click();
    await segunda.getByText('Conectado', { exact: true }).waitFor();
    page.once('dialog', (d) => d.accept(`Claude do cliente ${stamp}`));
    await segunda.getByRole('button', { name: 'Renomear' }).click();
    const renomeada = page.locator('.conexao', { hasText: `Claude do cliente ${stamp}` });
    await renomeada.waitFor();
    await renomeada.getByRole('button', { name: 'Usar como padrão nos projetos novos' }).click();
    await renomeada.locator('.selo-padrao').waitFor();
    await shot(page, '1-conexoes');
    // Ferramenta MCP pela tela: cria (com token secreto), testa (liga e lista as ferramentas) e exclui.
    const mcpStub = path.join(__dirname, '..', '..', 'backend', 'test', 'support', 'stubs', 'mcp-stub.cjs');
    const mcpSaida = path.join(os.tmpdir(), `mcp-smoke-${stamp}.json`);
    await page.getByRole('button', { name: 'Nova ferramenta' }).click();
    await page.locator('.modal .tipo-conexao', { hasText: 'GitHub' }).waitFor(); // modelos prontos
    await page.locator('.modal').getByLabel('Nome', { exact: true }).fill(`Eco ${stamp}`);
    await page.getByLabel('Comando').fill(`node ${mcpStub} ${mcpSaida}`);
    await page.getByRole('button', { name: '+ adicionar' }).click();
    await page.getByPlaceholder('API_KEY').fill('TOKEN_X');
    await page.getByPlaceholder('valor').fill('segredo-smoke');
    await shot(page, '1b-nova-ferramenta-mcp');
    await page.getByRole('button', { name: 'Criar ferramenta' }).click();
    const linhaMcp = page.locator('.conexao', { hasText: `Eco ${stamp}` });
    await linhaMcp.waitFor();
    await linhaMcp.getByRole('button', { name: 'Testar (liga e lista as ferramentas)' }).click();
    await linhaMcp.getByText(/Funcionando\. 1 ferramenta\(s\): eco/).waitFor({ timeout: 30000 });
    if (JSON.parse(fs.readFileSync(mcpSaida, 'utf8')).TOKEN_X !== 'segredo-smoke') throw new Error('o token não chegou à ferramenta MCP');
    if ((await page.content()).includes('segredo-smoke')) throw new Error('o token apareceu na tela');
    await shot(page, '1c-ferramenta-mcp-testada');
    page.once('dialog', (d) => d.accept());
    await linhaMcp.getByRole('button', { name: 'Excluir' }).click();
    await linhaMcp.waitFor({ state: 'detached' });
    passo('ferramenta MCP criada pela tela, testada (token chega ao programa, nunca à tela) e excluída');
    await page.locator('.conexao', { hasText: 'Claude (conta)' }).getByRole('button', { name: 'Usar como padrão nos projetos novos' }).click();
    for (const n of [`Claude API 1 ${stamp}`, `Claude do cliente ${stamp}`]) {
      page.once('dialog', (d) => d.accept());
      await page.locator('.conexao', { hasText: n }).getByRole('button', { name: 'Excluir conexão' }).click();
      await page.locator('.conexao', { hasText: n }).waitFor({ state: 'detached' });
    }
    passo('Conexões: duas contas do mesmo tipo com nomes e chaves próprios, renomear, padrão, excluir');

    // 2. Modelos
    await page.getByRole('link', { name: 'Modelos' }).click();
    await page.getByText('Software — Studio Workflow').first().waitFor(); // modelo pronto instalado
    await shot(page, '2a-modelos');
    await page.getByRole('button', { name: '+ Novo modelo' }).click();
    const modelo = `Sistemas ERP ${stamp}`;
    await page.getByLabel('Nome do modelo').fill(modelo);
    await page.getByRole('button', { name: /^Software Sistemas/ }).click();
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
    await page.getByRole('button', { name: 'Memória', exact: true }).click();
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
    // Enquanto roda: barra de porcentagem, etapa atual, tempo e última atividade (não parece travado).
    await page.locator('.andamento [role=progressbar]').waitFor({ timeout: 30000 });
    await page.locator('.andamento', { hasText: /Etapa 1 de 2: Escrever o cardápio/ }).waitFor();
    await page.locator('.andamento', { hasText: /Rodando há/ }).waitFor({ timeout: 15000 });
    await shot(page, '6b-andamento');
    await page.getByText(/Pronto\. O resultado/).waitFor({ timeout: 90000 });
    if (!fs.existsSync(path.join(ctl, 'prompt-revisor.txt'))) throw new Error('a conferência das regras não rodou');
    await page.getByText('Tom das peças', { exact: true }).waitFor({ timeout: 15000 });
    await shot(page, '7-pronto-memoria');
    // Item da memória abre para ler inteiro e copiar.
    const item = page.locator('.mem-item', { hasText: 'Tom das peças' });
    await item.locator('.mem-corpo').click();
    await page.locator('.mem-item.aberto', { hasText: 'Tom alegre e familiar.' }).waitFor();
    await item.getByRole('button', { name: 'Copiar' }).click();
    await item.locator('[title="Copiado"]').waitFor();
    // Cada item em um grupo só; anotações de trabalho da IA ficam recolhidas.
    if ((await page.locator('.mem-item', { hasText: 'Tom das peças' }).count()) !== 1) throw new Error('item repetido em mais de um grupo');
    await page.getByRole('button', { name: /^Memória$/ }).waitFor();
    passo('trabalho feito, conferido contra as regras e incorporado; memória automática visível, abre e copia');
    await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
    await page.getByRole('button', { name: 'cardapio.md', exact: true }).click();
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

    // Anexos no chat: imagem (miniatura) e documento Word (vira texto para a IA).
    await page.getByRole('button', { name: '+ Nova conversa' }).click();
    fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n{"tipo":"resposta","texto":"Recebi a foto e o documento.","memoria":[]}\n```');
    const png = path.join(tmp, 'foto.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const docx = path.join(tmp, 'pedido.docx');
    execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Pedido ANEXO-${stamp}</w:t></w:r></w:p></w:body></w:document>')`, docx]);
    await page.locator('form.entrada input[type=file]').setInputFiles([png, docx]);
    await page.locator('.anexos-pendentes .anexo-chip', { hasText: 'pedido.docx' }).waitFor();
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Veja a foto e o pedido');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.locator('.msg.eu .anexo-imagem img').waitFor();
    await page.locator('.msg.eu .anexo-chip', { hasText: 'pedido.docx' }).waitFor();
    await page.getByText('Recebi a foto e o documento.').waitFor();
    if (!fs.readFileSync(path.join(ctl, 'prompt.txt'), 'utf8').includes('pedido.txt (texto extraído de pedido.docx)')) throw new Error('documento não chegou à IA como texto');
    await shot(page, '9a-anexos-no-chat');
    for (const f of ['mode', 'resposta.txt']) fs.rmSync(path.join(ctl, f), { force: true });
    passo('anexos no chat: imagem com miniatura e Word lido como texto pela IA');

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
    await page.getByRole('heading', { name: 'Conexões', exact: true }).waitFor();
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

    // 8. GitLab: conta, repositório novo num grupo, escolher da lista
    const repos = [];
    const api = http.createServer((req, res) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => {
        const u = new URL(req.url, 'http://x');
        const json = (st, b) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
        if (req.headers['private-token'] !== 'glpat-SMOKE-123456') return json(401, {});
        if (u.pathname === '/api/v4/user') return json(200, { username: 'eu' });
        if (u.pathname === '/api/v4/namespaces') return json(200, [{ id: 1, full_path: 'eu', kind: 'user' }, { id: 9, full_path: 'empresa', kind: 'group' }]);
        if (u.pathname === '/api/v4/projects' && req.method === 'POST') {
          const b = JSON.parse(d);
          const nome = `${b.namespace_id === 9 ? 'empresa' : 'eu'}/${b.path}`;
          const caminho = path.join(tmp, 'gitlab', `${nome}.git`);
          fs.mkdirSync(path.dirname(caminho), { recursive: true });
          execFileSync('git', ['init', '-q', '--bare', '-b', 'main', caminho]);
          repos.push({ path_with_namespace: nome, http_url_to_repo: caminho, default_branch: 'main', visibility: b.visibility });
          return json(201, repos[repos.length - 1]);
        }
        if (u.pathname === '/api/v4/projects') return json(200, repos);
        json(404, {});
      });
    });
    await new Promise((ok) => api.listen(0, '127.0.0.1', ok));
    try {
      await page.goto(`${base}/contas`);
      await page.getByRole('button', { name: 'Nova', exact: true }).click();
      await page.locator('.tipo-conexao', { hasText: 'GitLab' }).click();
      await page.getByLabel('Nome da conexão').fill('GitLab Empresa');
      await page.getByLabel('Endereço do GitLab').fill(`http://127.0.0.1:${api.address().port}`);
      await page.getByLabel('Token de acesso').fill('glpat-SMOKE-123456');
      await page.getByRole('button', { name: 'Criar conexão' }).click();
      const contaGl = page.locator('.conexao', { hasText: 'GitLab Empresa' });
      await contaGl.waitFor();
      await contaGl.getByRole('button', { name: 'Testar o token agora' }).click();
      await contaGl.getByText('Token válido (usuário eu).').waitFor();
      await shot(page, '11a-conexoes-com-git');
      await page.getByRole('button', { name: '+ Novo projeto' }).click();
      const nomeNovo = `Painel ${stamp}`;
      await page.getByLabel('Nome do projeto').fill(nomeNovo);
      await page.locator('.modal .tipo', { hasText: 'Do zero + repositório novo' }).click();
      await page.getByLabel(/^Dono/).selectOption({ label: 'empresa (grupo)' });
      await shot(page, '12-novo-projeto-repo-novo');
      await page.getByRole('button', { name: 'Criar projeto' }).click();
      await page.getByRole('heading', { name: nomeNovo }).waitFor();
      await page.getByRole('button', { name: 'Git', exact: true }).click();
      await page.getByText(`/empresa/painel-${stamp}.git`).waitFor();
      if (!(await page.getByLabel(/Enviar sozinho/).isChecked())) throw new Error('envio automático deveria estar ligado');
      await shot(page, '13-git-repo-criado');
      const remotoNovo = repos[0].http_url_to_repo;
      if (!g(remotoNovo, 'rev-parse', 'main')) throw new Error('nada foi enviado ao repositório novo');
      // Trazer um projeto escolhendo da lista (o que acabou de ser criado).
      await page.getByRole('button', { name: '+ Novo projeto' }).click();
      await page.locator('.modal .tipo', { hasText: 'Trazer de um repositório Git' }).click();
      await page.locator('.repo-item', { hasText: `empresa/painel-${stamp}` }).click();
      await page.getByText(`Escolhido:`).waitFor();
      if ((await page.getByLabel('Nome do projeto').inputValue()) !== `painel-${stamp}`) throw new Error('nome não foi sugerido');
      await shot(page, '14-escolher-repo');
      await page.getByLabel('Nome do projeto').fill(`Cópia ${stamp}`);
      await page.getByRole('button', { name: 'Criar projeto' }).click();
      await page.getByRole('heading', { name: `Cópia ${stamp}` }).waitFor();
      passo('conta GitLab, projeto com repositório novo num grupo, escolher repositório da lista');
      for (const n of [nomeNovo, `Cópia ${stamp}`]) {
        await page.locator('.proj', { hasText: n }).click();
        page.once('dialog', (d) => d.accept(n));
        await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
        await page.getByRole('button', { name: 'Excluir este projeto' }).click();
        await page.locator('.proj', { hasText: n }).waitFor({ state: 'detached' });
      }
      await page.goto(`${base}/contas`);
      page.once('dialog', (d) => d.accept());
      await page.locator('.conexao', { hasText: 'GitLab Empresa' }).getByRole('button', { name: 'Excluir conexão' }).click();
      await page.locator('.conexao', { hasText: 'GitLab Empresa' }).waitFor({ state: 'detached' });
    } finally {
      api.close();
    }
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
