import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A habilidade integrada de geração de imagem do Codex pode mostrar uma imagem
 * na conversa, mas não oferece contrato de entrega de PNG binário dentro do
 * worktree do Nivoo. Sem bridge explícita, a etapa não pode cumprir test -s.
 *
 * Preflight conservador: vale somente para etapas que exigem CRIAR imagens
 * inéditas e verificam arquivos raster locais específicos. Operações sobre
 * imagens já existentes e tarefas de frontend não são bloqueadas.
 */
export interface ImageOutputStep {
  title: string;
  instructions: string;
  verifyCommand: string | null;
}

export function requiredRasterOutputs(command: string | null): string[] {
  if (!command) return [];
  const found: string[] = [];
  const re = /\btest\s+-s\s+(?:'([^']+)'|"([^"]+)"|([^\s&|;]+))/g;
  for (const m of command.matchAll(re)) {
    const filename = (m[1] ?? m[2] ?? m[3] ?? '').replace(/^\.\//, '');
    if (/\.(?:png|jpe?g|webp)$/i.test(filename) &&
        !path.isAbsolute(filename) &&
        !filename.split(/[\\/]/).includes('..')) found.push(filename);
  }
  return [...new Set(found)];
}

export function checkGeneratedImageOutputs(
  step: ImageOutputStep,
  providerId: string,
  workspace: string,
): string | null {
  // Somente CLIs conhecidos sem contrato de exportação de imagegen para disco.
  if (!/^(?:codex-cli|codex-api|claude-code-cli|claude-api)(?:--[\w-]+)?$/.test(providerId)) return null;
  const text = `${step.title}\n${step.instructions}`;
  const wantsOriginal = /\b(?:criar|gerar|produzir|desenhar|create|generate)\b[\s\S]{0,100}\b(?:fotos?|imagens?|ilustrações?|ilustracoes?|photos?|images?)\b/i.test(text) ||
    /\b(?:fotos?|imagens?|photos?|images?)\s+(?:novas?|inéditas?|ineditas?|originais?)\b/i.test(text);
  if (!wantsOriginal) return null;
  const targets = requiredRasterOutputs(step.verifyCommand);
  if (!targets.length) return null;
  const root = fs.realpathSync(workspace);
  const missing = targets.filter(rel => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) return true;
    try {
      const real = fs.realpathSync(abs);
      return !real.startsWith(root + path.sep) || !fs.statSync(real).isFile() || fs.statSync(real).size === 0;
    } catch { return true; }
  });
  if (!missing.length) return null;
  return `A etapa pede gerar imagens inéditas, mas o provedor ${providerId} não possui ponte validada para gravar os PNGs da ferramenta de imagens no workspace. Faltam: ${missing.join(', ')}. Não vou abrir sessões de IA que não podem passar na conferência. Anexe os arquivos de imagem no chat e aprove uma etapa de importação/cópia para estes destinos, ou configure uma ferramenta de geração com exportação local de binários e execute novo plano.`;
}
