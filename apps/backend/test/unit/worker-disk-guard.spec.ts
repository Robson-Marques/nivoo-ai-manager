import { armazenamentoDisponivel, MIN_FREE_DISK_BYTES, MIN_FREE_VIDEO_BYTES } from '../../src/common/disk-guard';

describe('proteções de armazenamento do worker', () => {
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
    expect(MIN_FREE_VIDEO_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });

});
