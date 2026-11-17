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
    steps: [{ key: 'c', title: 'Escrever o cardápio', instructions: "sleep 10; printf '# Cardápio\\n- Margherita\\n' > cardapio.md", verifyCommand: 'test -f cardapio.md' }],
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
    // Diagnóstico do sistema pela tela (para mandar ao suporte).
    await page.getByRole('link', { name: 'Diagnóstico' }).click();
    await page.getByRole('button', { name: 'Gerar diagnóstico do sistema' }).click();
    await page.locator('pre.diagnostico', { hasText: 'Diagnóstico do sistema Nivoo' }).waitFor({ timeout: 30000 });
    await page.locator('pre.diagnostico', { hasText: '## Worker' }).waitFor();
    await shot(page, '1a-diagnostico');
    await page.goto(`${base}/contas`);
    await page.getByRole('heading', { name: 'Conexões', exact: true }).waitFor();
    passo('diagnóstico do sistema gerado pela tela');
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
    // Variável da conferência (token de registro privado): guarda, vira chip "guardado", e o valor nunca aparece na tela.
    const confenv = page.locator('.campo', { hasText: 'Variáveis da conferência' });
    await confenv.getByPlaceholder(/NOME/).fill('GITLAB_PACKAGE_TOKEN');
    await confenv.getByPlaceholder(/valor/).fill(`tok-${stamp}`);
    await confenv.getByRole('button', { name: 'Guardar' }).click();
    await confenv.locator('.confenv-chip', { hasText: 'GITLAB_PACKAGE_TOKEN' }).waitFor();
    await page.getByText(/guardada\. O valor fica no servidor/).waitFor();
    if ((await confenv.innerText()).includes(`tok-${stamp}`)) throw new Error('o valor do token apareceu na tela');
    await shot(page, '5-ajustes');
    page.once('dialog', (d) => d.accept());
    await confenv.getByRole('button', { name: /Apagar GITLAB_PACKAGE_TOKEN/ }).click();
    await confenv.locator('.confenv-chip', { hasText: 'GITLAB_PACKAGE_TOKEN' }).waitFor({ state: 'detached' });
    passo('projeto criado no modelo, com regras próprias, conhecimento e variável da conferência (valor fora da tela)');

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
    // Pausar e Continuar: para na hora e guarda tudo; "Continuar" (logo em seguida) segue de onde parou.
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await page.getByText('Pausado por você. Tudo o que foi feito está salvo.').waitFor({ timeout: 20000 });
    await shot(page, '6c-pausado');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('.andamento [role=progressbar]').waitFor({ timeout: 30000 });
    passo('pausar e continuar o trabalho pela tela');
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

    // 4b. Revisão com dúvida que só o usuário responde: perguntas com respostas sugeridas; responder ali mesmo continua.
    // A entrega do cardápio (IA volta sozinha com o resumo) termina antes de preparar a próxima resposta da IA.
    await page.locator('.selo-entrega').first().waitFor({ timeout: 60000 });
    const prontosAntes = await page.locator('.progresso.p-CONCLUIDO').count();
    fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify({ ...plano, texto: 'Vou montar as bebidas.', memoria: [], job: { ...plano.job, title: 'Bebidas', objective: 'Criar bebidas.md', steps: [{ key: 'b', title: 'Escrever as bebidas', instructions: "printf '# Bebidas\\n' > bebidas.md", verifyCommand: 'test -f bebidas.md' }], criteria: [{ key: 'b', description: 'bebidas existe', kind: 'FILE_EXISTS', config: { path: 'bebidas.md' } }] } }) + '\n```');
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Agora as bebidas');
    await page.keyboard.press('Enter');
    await page.getByText('Vou montar as bebidas.').first().waitFor({ timeout: 60000 });
    fs.writeFileSync(path.join(ctl, 'mode'), 'bash');
    fs.writeFileSync(path.join(ctl, 'conforme'), 'duvida');
    await page.getByRole('button', { name: 'Fazer', exact: true }).last().click();
    await page.getByText('Perguntas para você').waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: 'Os títulos do documento X' }).click();
    if ((await page.locator('.resposta-revisao textarea').inputValue()) !== 'Os títulos do documento X') throw new Error('a resposta sugerida não preencheu a caixa');
    await shot(page, '7b-perguntas-da-revisao');
    fs.writeFileSync(path.join(ctl, 'conforme'), 'true');
    await page.getByRole('button', { name: 'Responder e continuar' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.progresso.p-CONCLUIDO').length > n, prontosAntes, { timeout: 90000 });
    fs.rmSync(path.join(ctl, 'conforme'), { force: true });
    passo('revisão com dúvida: perguntas com respostas sugeridas; responder ali mesmo e o trabalho conclui');

    // 4c. A IA pergunta com cartões de opções: clicar e enviar vira a resposta do usuário na conversa.
    fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify({
      tipo: 'resposta', texto: 'Preciso de duas decisões suas.', memoria: [],
      perguntas: [
        { pergunta: 'Qual tamanho de pizza no cardápio?', opcoes: [{ rotulo: 'Média e grande (recomendado)', descricao: 'as mais vendidas' }, { rotulo: 'Só grande', descricao: 'cardápio menor' }] },
        { pergunta: 'Mostrar preço?', opcoes: ['Sim', 'Não'] },
      ],
    }) + '\n```');
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Monte o cardápio de tamanhos');
    await page.keyboard.press('Enter');
    await page.locator('.perguntas-ia').last().waitFor({ timeout: 60000 });
    const cartoes = page.locator('.perguntas-ia').last();
    await cartoes.getByRole('button', { name: /Média e grande/ }).click();
    if (await cartoes.getByRole('button', { name: 'Enviar respostas' }).isEnabled()) throw new Error('enviou sem responder todas as perguntas');
    await cartoes.locator('.outra-ia').nth(1).fill('Sim, com preço promocional');
    await shot(page, '7c-perguntas-com-opcoes');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify({ tipo: 'resposta', texto: 'Anotado, sigo assim.', memoria: [] }) + '\n```');
    await cartoes.getByRole('button', { name: 'Enviar respostas' }).click();
    await page.getByText(/Minhas respostas:/).last().waitFor({ timeout: 30000 });
    await page.getByText('Anotado, sigo assim.').waitFor({ timeout: 60000 });
    await page.locator('.perguntas-ia.respondida').last().waitFor();
    fs.writeFileSync(path.join(ctl, 'mode'), 'bash');
    passo('a IA pergunta com cartões de opções; clicar (ou "Outra") e enviar vira a resposta na conversa');

    // 4d. Painéis recolhíveis: a lista de projetos recolhe para a esquerda; o painel da direita recolhe e as abas
    // ficam na barra de cima (abrem o painel direto nelas). Lembrado ao recarregar.
    await page.getByRole('button', { name: 'Recolher a lista de projetos' }).click();
    await page.locator('.chat-app.lado-recolhido').waitFor();
    await page.getByRole('button', { name: /Recolher painel/ }).click();
    await page.locator('.abas-topo').waitFor();
    if (await page.locator('aside.painel').count()) throw new Error('o painel não recolheu');
    await shot(page, '7d-paineis-recolhidos');
    await page.reload();
    await page.locator('.chat-app.lado-recolhido').waitFor();
    // Ao abrir a conversa, ela fica no fim (mesmo com cartões e resultados que carregam depois).
    await page.waitForTimeout(2500);
    const distanciaDoFim = await page.locator('.mensagens').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    if (distanciaDoFim > 40) throw new Error(`a conversa abriu longe do fim (${distanciaDoFim}px)`);
    await page.locator('.abas-topo').getByRole('button', { name: 'Arquivos' }).click();
    await page.locator('.painel .tab.active', { hasText: 'Arquivos' }).waitFor();
    await page.getByRole('button', { name: 'Mostrar os projetos' }).click();
    await page.locator('.chat-app:not(.lado-recolhido)').waitFor();
    await page.locator('.painel').getByRole('button', { name: 'Memória', exact: true }).click();
    passo('painéis recolhíveis: projetos para a esquerda, painel vira abas na barra de cima; lembrado ao recarregar');

    // 4e. Prévia do projeto em tela dividida: um trabalho cria o site; "Ver o projeto" → "Ligar a prévia" mostra o
    // site rodando ao lado da conversa (portão da prévia, endereço próprio); celular/computador; desligar.
    fs.writeFileSync(path.join(ctl, 'mode'), 'texto');
    fs.writeFileSync(path.join(ctl, 'resposta.txt'), '```json\n' + JSON.stringify({ ...plano, texto: 'Vou criar o site.', memoria: [], job: { ...plano.job, title: 'Site', objective: 'Criar index.html', steps: [{ key: 's', title: 'Criar o site', instructions: "printf '<!doctype html><h1>Pizzaria do Bairro</h1><p id=\\\"cardapio\\\">Margherita</p>' > index.html", verifyCommand: 'test -f index.html' }], criteria: [{ key: 's', description: 'site', kind: 'FILE_EXISTS', config: { path: 'index.html' } }] } }) + '\n```');
    await page.getByPlaceholder(/Escreva sua mensagem/).fill('Crie o site da pizzaria');
    await page.keyboard.press('Enter');
    await page.getByText('Vou criar o site.').first().waitFor({ timeout: 60000 });
    fs.writeFileSync(path.join(ctl, 'mode'), 'bash');
    const prontosSite = await page.locator('.progresso.p-CONCLUIDO').count();
    await page.getByRole('button', { name: 'Fazer', exact: true }).last().click();
    await page.waitForFunction((n) => document.querySelectorAll('.progresso.p-CONCLUIDO').length > n, prontosSite, { timeout: 90000 });
    await page.getByRole('button', { name: 'Ver o projeto' }).click();
    await page.locator('section.previa').waitFor();
    await page.locator('section.previa').getByRole('button', { name: 'Ligar a prévia' }).first().click();
    const quadro = page.frameLocator('iframe[title="Prévia do projeto"]');
    await quadro.getByText('Pizzaria do Bairro').waitFor({ timeout: 60000 });
    await page.locator('section.previa').getByRole('button', { name: 'Celular' }).click();
    await page.locator('.previa-moldura.t-celular').waitFor();
    await shot(page, '7e-previa-tela-dividida');
    await page.locator('section.previa').getByRole('button', { name: 'Desligar' }).click();
    await page.locator('section.previa .e-parada').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Fechar prévia' }).click();
    await page.locator('section.previa').waitFor({ state: 'detached' });
    passo('prévia em tela dividida: o site do projeto aparece ao lado da conversa (computador/celular), liga e desliga');
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
    // "+" na linha do projeto abre uma conversa nova; clicar de novo reaproveita a que ainda está vazia.
    const linhaProjeto = page.locator('.proj-linha.on');
    await linhaProjeto.getByRole('button', { name: /Nova conversa em/ }).click();
    await page.getByText(/Nova conversa\. A IA já conhece/).waitFor();
    const urlNova = page.url();
    await linhaProjeto.getByRole('button', { name: /Nova conversa em/ }).click();
    await page.waitForTimeout(500);
    if (page.url() !== urlNova) throw new Error('o "+" criou outra conversa em branco em vez de abrir a vazia');
    if ((await page.locator('.conversa-item', { hasText: 'Nova conversa' }).count()) !== 1) throw new Error('mais de uma "Nova conversa" em branco no menu');
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).hover();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).getByRole('button', { name: /Opções/ }).click();
    await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).waitFor({ state: 'detached' });
    // Arquivados: um botão só, no rodapé do menu; abre a janela com projetos e conversas arquivadas.
    if ((await page.locator('.chat-side').getByText(/arquivad/i).count()) !== 1) throw new Error('sobrou link de arquivados solto no menu');
    await page.locator('.side-foot').getByRole('button', { name: 'Arquivados' }).click();
    const janela = page.getByRole('dialog', { name: 'Arquivados' });
    const arquivada = janela.locator('.arq-item', { hasText: 'Quero o cardápio' });
    await arquivada.waitFor();
    await shot(page, '9-arquivados');
    await arquivada.getByRole('button', { name: 'Desarquivar' }).click();
    await arquivada.waitFor({ state: 'detached' });
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).waitFor(); // voltou para o menu
    await janela.getByText(/Nada arquivado/).waitFor();
    await janela.getByRole('button', { name: 'Fechar' }).click();
    // Arquiva de novo e exclui pela janela.
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).hover();
    await page.locator('.conversa-item', { hasText: 'Quero o cardápio' }).getByRole('button', { name: /Opções/ }).click();
    await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await page.locator('.side-foot').getByRole('button', { name: 'Arquivados' }).click();
    page.once('dialog', (d) => d.accept());
    await janela.getByRole('button', { name: /Excluir a conversa Quero o cardápio/ }).click();
    await janela.getByText(/Nada arquivado/).waitFor();
    await janela.getByRole('button', { name: 'Fechar' }).click();
    await shot(page, '9d-menu-projetos');
    passo('nova conversa, conversa arquivada e excluída');

    // Anexos no chat: imagem (miniatura) e documento Word (vira texto para a IA). O "+" abre a conversa vazia que já existe.
    await page.locator('.proj-linha.on').getByRole('button', { name: /Nova conversa em/ }).click();
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

    // Vídeo para editar: arrastar no chat envia por streaming para a mídia do projeto (não vira anexo) e vira chip.
    const videoMp4 = path.join(tmp, 'abertura.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoMp4]);
    await page.locator('form.entrada input[type=file]').setInputFiles(videoMp4);
    await page.locator('.video-chip', { hasText: 'abertura.mp4' }).waitFor({ timeout: 30000 });
    if ((await page.locator('.anexo-chip', { hasText: 'abertura.mp4' }).count()) !== 0) throw new Error('o vídeo virou anexo da mensagem em vez de ir para a mídia');
    await shot(page, '9a2-video-para-editar');
    passo('vídeo arrastado no chat vai por streaming para a mídia do projeto e aparece como chip de edição');

    // Ditado: o microfone usa o reconhecimento de fala do navegador (aqui simulado, sem microfone) e escreve na caixa.
    await page.evaluate(() => {
      class Falso {
        start() {
          window.__ditadoLang = this.lang;
          setTimeout(() => this.onresult?.({ results: [[{ transcript: 'quero o cardápio' }], [{ transcript: ' de sexta' }]] }), 100);
        }
        stop() {
          setTimeout(() => this.onend?.(), 10);
        }
        abort() {}
      }
      window.SpeechRecognition = Falso;
    });
    await page.getByRole('button', { name: 'Falar a mensagem' }).click();
    await page.getByText(/Ouvindo… fale normalmente/).waitFor();
    await page.waitForFunction(() => document.querySelector('form.entrada textarea')?.value === 'quero o cardápio de sexta');
    await shot(page, '9f-ditado');
    if ((await page.evaluate(() => window.__ditadoLang)) !== 'pt-BR') throw new Error('o ditado não está em português');
    await page.getByRole('button', { name: 'Parar o ditado' }).click();
    await page.getByText(/Ouvindo… fale normalmente/).waitFor({ state: 'detached' });
    // Navegador sem ditado (ex.: Firefox): explica o que usar em vez de não fazer nada.
    await page.evaluate(() => {
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
    });
    await page.getByRole('button', { name: 'Falar a mensagem' }).click();
    await page.getByText(/Este navegador não faz ditado/).waitFor();
    await page.locator('form.entrada textarea').fill('');
    passo('ditado por voz: o microfone escreve a fala na caixa (português), para no clique; sem suporte, explica');

    // 5b. Servidor SSH: cadastro pela tela (chave gerada pelo Nivoo), teste, e a IA pedindo um comando que só roda
    // depois do "Permitir" na conversa.
    const urlProjeto = page.url();
    const pid = new URL(urlProjeto).pathname.split('/')[2];
    await page.goto(`${base}/contas`);
    await page.getByRole('button', { name: 'Novo servidor' }).click();
    await page.locator('.modal').getByLabel('Nome', { exact: true }).fill(`Produção ${stamp}`);
    await page.locator('.modal').getByLabel('Endereço').fill('servidor.teste');
    await page.locator('.modal').getByLabel('Usuário').fill('deploy');
    await page.locator('.modal').getByText('Todos os projetos').click();
    await page.getByRole('button', { name: 'Criar e gerar a chave' }).click();
    const linhaSsh = page.locator('.conexao', { hasText: `Produção ${stamp}` });
    await linhaSsh.locator('.chave-ssh pre', { hasText: 'ssh-ed25519' }).waitFor();
    await linhaSsh.getByRole('button', { name: 'Testar o acesso' }).click();
    await linhaSsh.getByText('Acesso funcionando').waitFor({ timeout: 30000 });
    await shot(page, '9b-servidor-ssh');
    const servidores = await (await fetch(`${base}/api/ssh/servidores`)).json();
    const srv = servidores.find((x) => x.nome === `Produção ${stamp}`);
    const { spawn } = require('node:child_process');
    const mcp = spawn(process.execPath, [path.join(__dirname, '..', '..', 'backend', 'dist', 'mcp', 'ssh-mcp.js')], {
      env: { ...process.env, NIVOO_PROJETO_ID: pid, NIVOO_SSH_SERVIDORES: JSON.stringify([{ id: srv.id, nome: srv.nome, host: srv.host, usuario: srv.usuario }]), NIVOO_SSH_INTERVALO_MS: '300' },
    });
    let saidaMcp = '';
    mcp.stdout.on('data', (d) => (saidaMcp += d));
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'executar_no_servidor', arguments: { servidor: srv.nome, comando: 'echo ola-smoke', motivo: 'conferir o servidor' } } }) + '\n');
    await page.goto(urlProjeto);
    const cartao = page.locator('.pedido-ssh', { hasText: 'echo ola-smoke' });
    await cartao.waitFor({ timeout: 30000 });
    await shot(page, '9c-pedido-ssh');
    await cartao.getByRole('button', { name: 'Permitir' }).click();
    await cartao.waitFor({ state: 'detached', timeout: 15000 });
    for (let i = 0; i < 50 && !saidaMcp.includes('"id":2'); i++) await new Promise((ok) => setTimeout(ok, 200));
    mcp.kill();
    if (!/Permitido por .* e executado em Produção .*ola-smoke/.test(saidaMcp)) throw new Error(`a IA não recebeu a saída do comando permitido: ${saidaMcp.slice(-300)}`);
    await fetch(`${base}/api/ssh/servidores/${srv.id}`, { method: 'DELETE' });
    passo('servidor SSH cadastrado (chave do Nivoo), testado; comando da IA só rodou depois do "Permitir" na conversa');

    // Projeto arquivado: sai do grupo e aparece em "Arquivados"; aberto, fica no menu como "Arquivado"; desarquivar traz de volta.
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'Arquivar projeto' }).click();
    await page.locator('.proj-linha.arquivado', { hasText: nome }).waitFor();
    await page.locator('.side-foot').getByRole('button', { name: 'Arquivados' }).click();
    const janelaProjetos = page.getByRole('dialog', { name: 'Arquivados' });
    const projetoArquivado = janelaProjetos.locator('.arq-item', { hasText: nome });
    await projetoArquivado.waitFor();
    await shot(page, '9e-projeto-arquivado');
    await projetoArquivado.getByRole('button', { name: 'Desarquivar' }).click();
    await projetoArquivado.waitFor({ state: 'detached' });
    await janelaProjetos.getByRole('button', { name: 'Fechar' }).click();
    await page.locator('.proj-linha:not(.arquivado)', { hasText: nome }).waitFor();
    await page.getByRole('button', { name: 'Arquivar projeto' }).waitFor(); // a tela do projeto acompanhou
    passo('projeto arquivado aparece em "Arquivados" (e no menu enquanto aberto); desarquivar traz de volta');

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
