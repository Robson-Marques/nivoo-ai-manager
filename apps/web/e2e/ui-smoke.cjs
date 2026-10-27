/**
 * Teste de fumaça da interface (Playwright) contra uma instância real (API + worker).
 * Uso: NIVOO_UI_URL=http://localhost:3000 SHOTS=/caminho node apps/web/e2e/ui-smoke.cjs
 * Requer o pacote playwright com Chromium instalado.
 * Percorre as 4 telas criando projeto, pesquisa, hipótese e um job pelo formulário.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.NIVOO_UI_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const stamp = Date.now().toString(36);

(async () => {
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('dialog', async (d) => {
  const m = d.message();
  if (/nome/i.test(m)) await d.accept('Operador UI');
  else if (/motivo/i.test(m)) await d.accept('teste de interface');
  else if (/Conclusão/i.test(m)) await d.accept('ok');
  else await d.accept();
});
const fail = (msg) => {
  console.error('FALHA:', msg);
  process.exitCode = 1;
};

try {
  // 1. Painel
  await page.goto(base);
  await page.getByRole('heading', { name: 'Painel Mercado' }).waitFor();
  await page.getByText('Mini Índice Bovespa').waitFor();
  await page.getByText('Mini Dólar Comercial').waitFor();
  await shot(page, '1-painel');

  // 2. Projetos e pesquisas
  await page.getByRole('link', { name: 'Projetos e pesquisas' }).click();
  await page.getByLabel('Nome').fill(`UI ${stamp}`);
  await page.getByLabel(/Especificação/).fill('Projeto criado pelo teste de interface.');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('heading', { name: `UI ${stamp}` }).waitFor();
  await page.getByLabel('Título').fill('Reversão pós-gap');
  await page.getByLabel('Pergunta de pesquisa').fill('Gaps de abertura do WIN revertem na primeira hora?');
  await page.getByRole('button', { name: 'Criar pesquisa' }).click();
  await page.getByRole('heading', { name: 'Reversão pós-gap' }).waitFor();
  await page.getByLabel('Nova hipótese').fill('Gaps > 300 pts revertem 50% em 60 min');
  await page.getByRole('button', { name: 'Registrar hipótese' }).click();
  await page.getByText('Gaps > 300 pts revertem 50% em 60 min').first().waitFor();
  await shot(page, '2-projeto-pesquisa');

  // Job via formulário
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Medição de gaps (UI)');
  await page.getByLabel(/Objetivo/).fill('Gerar métricas de teste e relatório.');
  await page.getByLabel(/Instruções/).fill('echo "medindo"; echo \'{"amostras": 42}\' > out/metrics.json; echo "# ok" > out/relatorio.md');
  await page.getByLabel('Configuração (JSON)').fill('{"name": "relatorio.md"}');
  await page.getByRole('button', { name: 'Criar e iniciar' }).click();

  // 3. Execução em tempo real
  await page.getByText('● ao vivo').waitFor({ timeout: 15000 });
  await page.locator('.title-row .status', { hasText: 'Concluído' }).waitFor({ timeout: 30000 });
  await page.locator('.logs').getByText('medindo').waitFor({ timeout: 10000 });
  await page.getByRole('link', { name: 'metrics.json' }).waitFor();
  await shot(page, '3-execucao-job');
  await page.getByRole('link', { name: 'Execução', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Execução e acompanhamento' }).waitFor();
  await page.getByText('Medição de gaps (UI)').first().waitFor();
  await shot(page, '3b-execucao-lista');

  // 4. Conectores e configurações
  await page.getByRole('link', { name: 'Conectores e configurações' }).click();
  await page.getByText('Claude Code CLI').waitFor();
  await page.getByText('OpenAI Codex CLI').waitFor();
  await page.getByText('Configuração WIN (independente)').waitFor();
  await page.getByText('Configuração WDO (independente)').waitFor();
  await shot(page, '4-conectores');
  console.log('UI OK: 4 telas verificadas; job criado pelo formulário e concluído pelo verificador.');
} catch (e) {
  await shot(page, 'erro');
  fail(e.message);
} finally {
  await browser.close();
}
})();
