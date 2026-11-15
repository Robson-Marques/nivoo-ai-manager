/**
 * Tela de entrada com NIVOO_API_TOKEN ligado: aparece UMA vez (mesmo com várias telas pedindo dados ao mesmo
 * tempo), recusa token errado, entra com o certo e não pergunta de novo ao recarregar.
 *   NIVOO_API_TOKEN=xyz node apps/backend/dist/main.js &   NIVOO_API_TOKEN=xyz node apps/web/e2e/entrada-smoke.cjs
 */
const { chromium } = require('playwright');
const base = process.env.NIVOO_UI_URL ?? 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let prompts = 0;
  page.on('dialog', (d) => { prompts++; d.dismiss(); });
  try {
    await page.goto(base);
    await page.locator('.entrada-caixa').waitFor();
    await page.waitForTimeout(1500);
    if ((await page.locator('.entrada-caixa').count()) !== 1) throw new Error('mais de uma tela de entrada');
    await page.getByLabel('Token de acesso').fill('errado');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByText('Token não confere').waitFor();
    await page.getByLabel('Token de acesso').fill(process.env.NIVOO_API_TOKEN);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.locator('.entrada-caixa').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '+ Novo projeto' }).waitFor();
    await page.reload();
    await page.waitForTimeout(1500);
    if (await page.locator('.entrada-caixa').count()) throw new Error('pediu de novo depois de recarregar');
    if (prompts) throw new Error('abriu caixinha do navegador');
    console.log('ENTRADA-SMOKE OK');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
