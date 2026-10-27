/**
 * Etapa longa e retomável: grava progresso em out/progress.txt a cada iteração e
 * continua de onde parou. Usada para provar interrupção/retomada sem perda de estado.
 */
export function resumableCounter(total: number, sleepSec = 0.4): string {
  return [
    'n=$(cat out/progress.txt 2>/dev/null || echo 0)',
    'echo "inicio em $n"',
    `while [ "$n" -lt ${total} ]; do n=$((n+1)); echo "$n" > out/progress.txt; echo "passo $n"; sleep ${sleepSec}; done`,
    'echo "total=$n" > out/final.txt',
    'echo fim',
  ].join('\n');
}
