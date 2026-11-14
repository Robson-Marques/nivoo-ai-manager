/**
 * Teste de ponta a ponta da interface (Playwright) contra uma instância real (API + worker).
 * Uso: NIVOO_UI_URL=http://localhost:3000 SHOTS=/caminho node apps/web/e2e/ui-smoke.cjs
 * Requer o pacote playwright com Chromium instalado.
 *
 * Percorre TUDO pela tela, sem chamar a API diretamente:
 *  1. Painel Mercado (WIN e WDO)
 *  2. Projeto → Configurações: orçamento do projeto e critério permanente
 *  3. Pesquisa → hipótese com regra pré-registrada → encerrar antes da hora é recusado (pendências)
 *  4. Job pelo formulário (executor local), vinculado à pesquisa como experimento
 *  5. Execução em tempo real: CONCLUÍDO, critério permanente aplicado, sessões, logs, artefatos
 *  6. Hipótese decidida pela regra (VALIDADA) → pesquisa encerrada
 *  7. Conectores e configurações
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.NIVOO_UI_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const stamp = Date.now().toString(36);
const passo = (msg) => console.log(`  ok  ${msg}`);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('dialog', async (d) => {
    const m = d.message();
    if (/nome/i.test(m)) await d.accept('Operador UI');
    else if (/motivo/i.test(m)) await d.accept('teste de interface');
    else await d.accept();
  });
  try {
    // 1. Painel
    await page.goto(`${base}/painel`); // a tela inicial agora é o chat; o painel fica no modo avançado
    await page.getByRole('heading', { name: 'Painel Mercado' }).waitFor();
    await page.getByText('Mini Índice Bovespa').waitFor();
    await page.getByText('Mini Dólar Comercial').waitFor();
    await shot(page, '1-painel');
    passo('Painel Mercado com WIN e WDO');

    // 2. Projeto + configurações
    await page.getByRole('link', { name: 'Projetos e pesquisas' }).click();
    await page.getByLabel('Nome').fill(`UI ${stamp}`);
    await page.getByLabel(/Especificação/).fill('Projeto criado pelo teste de interface.');
    await page.getByRole('button', { name: 'Criar projeto' }).click();
    await page.getByRole('heading', { name: `UI ${stamp}` }).waitFor();
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByLabel(/Limite total/).fill('10');
    await page.getByRole('button', { name: 'Salvar orçamento' }).click();
    await page.getByText('de US$ 10.00').waitFor();
    await page.getByLabel('Chave').fill('python-ok');
    await page.getByLabel('Descrição').fill('o python do servidor funciona');
    await page.getByLabel('Configuração (JSON)').fill('{"command": "python3 -c \\"print(1)\\""}');
    await page.getByRole('button', { name: 'Adicionar critério permanente' }).click();
    await page.getByText('o python do servidor funciona').waitFor();
    await shot(page, '2-configuracoes-projeto');
    passo('orçamento do projeto e critério permanente');

    // 3. Pesquisa + hipótese com regra pré-registrada
    await page.getByRole('button', { name: 'Pesquisas', exact: true }).click();
    await page.getByLabel('Título').fill('Reversão pós-gap');
    await page.getByLabel('Pergunta de pesquisa').fill('Gaps de abertura do WIN revertem na primeira hora?');
    await page.getByRole('button', { name: 'Criar pesquisa' }).click();
    await page.getByRole('heading', { name: /Reversão pós-gap/ }).waitFor();
    await page.getByLabel('Nova hipótese').fill('H1: a amostra tem pelo menos 10 dias');
    await page.getByLabel(/Métrica/).fill('amostras');
    await page.getByLabel('Valor').fill('10');
    await page.getByLabel('Dados exigidos').selectOption('');
    await page.getByRole('button', { name: 'Registrar hipótese' }).click();
    await page.getByText('Regra pré-registrada:').waitFor();
    await page.getByText('aguardando experimento concluído').waitFor();
    await page.getByRole('button', { name: 'Encerrar pesquisa' }).click();
    await page.getByText('A pesquisa não pode ser encerrada enquanto houver pendências').waitFor();
    await page.getByText(/hipótese em investigação: H1/).waitFor();
    await shot(page, '3-pesquisa-hipotese-regra');
    passo('hipótese com regra pré-registrada; encerramento prematuro recusado com pendências');

    // 4. Job pelo formulário, como experimento da pesquisa
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill('Medição de gaps (UI)');
    await page.getByLabel(/Objetivo/).fill('Gerar métricas de teste e relatório.');
    await page.getByLabel(/Pesquisa \(opcional\)/).selectOption({ label: 'Reversão pós-gap' });
    await page.getByLabel(/Instruções/).fill('echo "medindo"; echo \'{"amostras": 42}\' > out/metrics.json; echo "# ok" > out/relatorio.md');
    await page.getByLabel('Configuração (JSON)').fill('{"name": "relatorio.md"}');
    await page.getByLabel(/Registrar como experimento/).check();
    await page.getByLabel('Nome', { exact: true }).fill('exp-ui');
    await page.getByRole('button', { name: 'Criar e iniciar' }).click();

    // 5. Execução em tempo real
    await page.getByText('● ao vivo').waitFor({ timeout: 15000 });
    await page.locator('.title-row .status', { hasText: 'Concluído' }).waitFor({ timeout: 60000 });
    await page.locator('.logs').getByText('medindo').waitFor({ timeout: 10000 });
    await page.getByText('invariante:python-ok', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Sessões e tentativas' }).waitFor();
    await page.getByRole('link', { name: 'metrics.json' }).waitFor();
    await shot(page, '5-execucao-job');
    passo('job concluído pelo verificador; critério permanente aplicado; sessões, logs e artefatos visíveis');

    // 6. Decisão pela regra e encerramento
    await page.getByRole('link', { name: `UI ${stamp}` }).click();
    await page.getByRole('button', { name: 'Decidir pela regra' }).click();
    await page.getByText(/Conclusão: VALIDADA pela regra pré-registrada amostras >= 10: valor observado 42/).waitFor();
    await page.getByRole('button', { name: 'Encerrar pesquisa' }).click();
    await page.locator('.tag.r-ENCERRADA').waitFor();
    await page.getByRole('button', { name: 'Memória', exact: true }).click();
    await page.getByRole('heading', { name: 'Resultados validados (1)' }).waitFor();
    await page.getByRole('heading', { name: 'Hipóteses em investigação (0)' }).waitFor(); // substituída pela decisão
    await shot(page, '6-pesquisa-encerrada');
    passo('hipótese VALIDADA pela regra; pesquisa encerrada; resultado na memória');

    await page.getByRole('link', { name: 'Execução', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Execução e acompanhamento' }).waitFor();
    await page.getByText('Medição de gaps (UI)').first().waitFor();

    // 7. Conectores
    await page.getByRole('link', { name: 'Contas de IA e configurações' }).click();
    await page.getByText('Claude Code CLI').waitFor();
    await page.getByText('OpenAI Codex CLI').waitFor();
    await page.getByText('Configuração WIN (independente)').waitFor();
    await page.getByText('Configuração WDO (independente)').waitFor();
    await shot(page, '7-conectores');
    passo('conectores e configuração independente de WIN/WDO');
    console.log('UI OK: todos os recursos verificados pela interface.');
  } catch (e) {
    await shot(page, 'erro');
    console.error('FALHA:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
