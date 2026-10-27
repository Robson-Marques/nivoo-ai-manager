/**
 * Configurações independentes por ativo (B3). Valores operacionais iniciais;
 * podem ser ajustados pela tela de configurações (PATCH /market/assets/:code).
 * Nenhuma estratégia de trading é implementada nesta versão.
 */
export const ASSET_DEFAULTS = [
  {
    code: 'WIN',
    name: 'Mini Índice Bovespa',
    exchange: 'B3',
    currency: 'BRL',
    priceUnit: 'pontos de índice',
    tickSize: '5',
    pointValue: '0.20',
    sessionTz: 'America/Sao_Paulo',
    sessionOpen: '09:00',
    sessionClose: '18:25',
    rules: {
      vencimento: 'meses pares (G, J, M, Q, V, Z), quarta-feira mais próxima do dia 15',
      simboloContinuo: 'WIN$',
      rolagem: 'documentar critério de rolagem por pesquisa; não misturar vencimentos sem ajuste',
      resultadoFinanceiro: 'pontos × R$ 0,20 × contratos',
    },
    validation: {
      minPrice: 50000,
      maxPrice: 250000,
      priceMustBeTickMultiple: true,
      maxBarRangePoints: 5000,
      requireSessionHours: true,
      requiredColumns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
    },
  },
  {
    code: 'WDO',
    name: 'Mini Dólar Comercial',
    exchange: 'B3',
    currency: 'BRL',
    priceUnit: 'R$ por US$ 1.000',
    tickSize: '0.5',
    pointValue: '10.00',
    sessionTz: 'America/Sao_Paulo',
    sessionOpen: '09:00',
    sessionClose: '18:30',
    rules: {
      vencimento: 'mensal, primeiro dia útil do mês de vencimento',
      simboloContinuo: 'WDO$',
      rolagem: 'rolagem no fim do mês; documentar critério por pesquisa',
      resultadoFinanceiro: 'pontos × R$ 10,00 × contratos',
    },
    validation: {
      minPrice: 3000,
      maxPrice: 10000,
      priceMustBeTickMultiple: true,
      maxBarRangePoints: 300,
      requireSessionHours: true,
      requiredColumns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
    },
  },
] as const;
