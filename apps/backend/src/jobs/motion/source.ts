import { readMotionInvocation } from './command';

const pathIsMotion = (s: string) =>
  /^motion\/[A-Za-z0-9._/-]+$/.test(s) && !s.split('/').includes('..');
const validSource = (s: string) =>
  pathIsMotion(s) && s !== 'motion' && !s.endsWith('/index.html') && !s.endsWith('/scene.json');

// O compositor e o renderizador devem apontar para a mesma fonte.
// Uma pasta de revisão pode conter scene.json antigo e index.html novo.
const RENDER_CALL = /(?:^|[;&|\n])\s*(?:env\s+)?(?:\/usr\/local\/bin\/)?nivoo-renderizar-motion\s+(?:"([^"]+)"|'([^']+)'|(motion\/[A-Za-z0-9._/-]+))(?=\s|$)/m;

export function renderSource(command: string): string | null {
  const val = readMotionInvocation(command)?.source ?? '';
  const source = val.replace(/\/(?:index\.html|scene\.json)$/, '');
  return validSource(source) ? source : null;
}

export function selectSource(command: string, source: string, filename = 'index.html'): string {
  return command.replace(RENDER_CALL, (match, double, single, bare) => {
    const old = double !== undefined ? '"' + double + '"' :
      single !== undefined ? "'" + single + "'" : bare;
    const entry = source + '/' + filename;
    const next = double !== undefined ? '"' + entry + '"' :
      single !== undefined ? "'" + entry + "'" : entry;
    return match.slice(0, -old.length) + next;
  });
}

/** Explicit mode is part of the author→renderer contract. */
export function selectRenderMode(command: string, source: string, mode: 'scene' | 'hybrid' | 'html'): string {
  const entry=selectSource(command,source,mode==='scene'?'scene.json':'index.html');
  const flag=/--motor\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+)/;
  if(flag.test(entry))return entry.replace(flag,'--motor '+mode);
  return entry.replace(RENDER_CALL,m=>m+' --motor '+mode);
}

export function selectStandaloneHtml(command: string, source: string): string {
  return selectRenderMode(command,source,'html');
}
