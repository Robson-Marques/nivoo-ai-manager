import { minimalEnv, runProcess } from '../common/exec';

/** Dados do vínculo Git do projeto (Project.gitUrl/gitBranch). */
export interface VinculoGit {
  gitUrl: string | null;
  gitBranch: string | null;
}

/** Endereço sem usuário/senha embutidos (nunca vão para o texto da IA). */
const semCredencial = (url: string) => url.replace(/\/\/[^@/]+@/, '//');

/**
 * O que a IA precisa saber do repositório do projeto, sem rede (estado da última consulta feita pela aba Git ou
 * pelo envio): esta pasta É o projeto (a main da pasta principal do Nivoo), ligada ao GitHub/GitLab quando houver.
 * Caso real (IA Studio): a conversa rodava numa cópia sem .git, o "git status" dizia "not a git repository" e a IA
 * parava pedindo "a pasta original em C:\Users\..." e depois o endereço do repositório — que já estava ligado e em dia.
 */
export async function textoDoRepositorio(repo: string, v: VinculoGit, opcoes: { semPastaGit?: boolean } = {}): Promise<string[]> {
  const git = async (args: string[]) => {
    const r = await runProcess('git', ['-C', repo, ...args], { cwd: repo, env: minimalEnv(), timeoutMs: 20_000 }).catch(() => null);
    return r && r.exitCode === 0 ? r.stdout.trim() : '';
  };
  const ultimo = await git(['log', '-1', '--format=%h "%s" (%cs)', 'main']);
  const base = `a branch main da pasta principal do projeto no Nivoo${ultimo ? ` (último commit ${ultimo})` : ''}`;
  const linhas = ['## Repositório do projeto'];
  if (v.gitUrl && v.gitBranch) {
    linhas.push(`- Esta pasta É o projeto inteiro: ${base}, ligada ao repositório ${semCredencial(v.gitUrl)} (branch ${v.gitBranch}).`);
    const conta = await git(['rev-list', '--left-right', '--count', `main...refs/remotes/origin/${v.gitBranch}`]);
    const [enviar, receber] = conta ? conta.split(/\s+/).map(Number) : [NaN, NaN];
    if (Number.isFinite(receber)) {
      linhas.push(
        receber > 0
          ? `- Na última consulta, o repositório tinha ${receber} commit(s) que ainda não estão aqui. Se o pedido depende deles, avise o usuário para clicar em Git → "Atualizar do Git"; senão, siga com esta pasta e diga isso no texto.`
          : `- Na última consulta, esta pasta estava em dia com o repositório${enviar > 0 ? ` (${enviar} commit(s) daqui ainda não enviados)` : ''}.`,
      );
    }
    linhas.push('- Para ler, auditar ou mudar o projeto, use ESTA pasta. Não peça o endereço do repositório, não pergunte qual é, não peça autorização para usá-lo e não tente baixá-lo de novo.');
  } else {
    linhas.push(`- Esta pasta É o projeto inteiro: ${base}. O projeto não está ligado a um repositório remoto (só local).`);
  }
  if (opcoes.semPastaGit) {
    linhas.push('- Esta cópia não traz a pasta .git: "git status" responde "not a git repository" — é esperado, não é bloqueio. O histórico dos commits está em contexto/historico-git.txt.');
  }
  linhas.push('- Caminhos de outra máquina citados nas regras, na memória ou no pedido (ex.: C:\\Users\\...\\<projeto>, /home/<pessoa>/<projeto>) são ESTE mesmo projeto: aqui ele é esta pasta. Nunca pare nem peça a pasta original por causa disso.');
  return linhas;
}

/** Histórico recente dos commits da main (para a cópia da conversa, que não tem .git). */
export async function historicoGit(repo: string, n = 60): Promise<string> {
  const r = await runProcess('git', ['-C', repo, 'log', `-${n}`, '--format=%h %cs %an — %s', 'main'], { cwd: repo, env: minimalEnv(), timeoutMs: 20_000 }).catch(() => null);
  return r && r.exitCode === 0 ? r.stdout : '';
}
