import { looksLikeResourceProblem } from '../../src/providers/provider.interface';

describe('limite de uso da IA é reconhecido (espera ou IA reserva, em vez de tentar de novo na hora)', () => {
  it.each([
    "api_error: You've hit your 5-hour limit · resets 12:10am (America/Sao_Paulo)",
    "You've hit your weekly limit · resets Mon 9:00am",
    "You've hit your usage limit. Upgrade to Pro or try again in 2 hours.",
    'Claude AI usage limit reached|1731700000',
    'Error: 429 Too Many Requests',
    'overloaded_error: Overloaded',
  ])('%s', (msg) => expect(looksLikeResourceProblem(msg)).toBe(true));
  it('erro comum do trabalho não é limite', () => {
    expect(looksLikeResourceProblem('verificação da etapa falhou (exit 1): 2 testes falharam')).toBe(false);
    expect(looksLikeResourceProblem('Error: Cannot find module ./limite')).toBe(false);
  });
});
