import { armazenamentoDisponivel, MIN_FREE_DISK_BYTES } from '../../src/worker/worker-runner.service';
import { MAX_REVISOES_VISUAIS_AUTOMATICAS } from '../../src/worker/step-executor.service';

describe('proteções contra disco cheio e revisões visuais infinitas', () => {
  it('não inicia tarefas quando o armazenamento disponível é insuficiente', () => {
    const semMinimo = armazenamentoDisponivel(['/'], 0);
    expect(semMinimo.ok).toBe(true);
    const semEspaco = armazenamentoDisponivel(['/'], Number.MAX_SAFE_INTEGER);
    expect(semEspaco.ok).toBe(false);
    expect(semEspaco.pasta).toBe('/');
    expect(typeof semEspaco.livre).toBe('number');
    expect(semEspaco.livre).toBeGreaterThanOrEqual(0);
  });

  it('reserva 512 MiB antes de tarefas que produzem imagens e vídeos', () => {
    expect(MIN_FREE_DISK_BYTES).toBe(512 * 1024 * 1024);
  });

  it('limita a dois os ciclos automáticos de revisão visual reprovada', () => {
    expect(MAX_REVISOES_VISUAIS_AUTOMATICAS).toBe(2);
  });
});
