import { lstat, realpath, stat, readFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { assertWorkspacePath, runVideoTool, ToolResult } from './video-tool-adapters';

/**
 * Execute a trusted, pre-bundled Remotion entrypoint using a provisioned CLI.
 * The worker must generate the bundle and JSON props from authorized media,
 * not from user-supplied executable source.
 */
export async function renderRemotionComposition(
  workspaceRoot: string,
  bundleDirectory: string,
  compositionId: string,
  propsFile: string,
  outputFile: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(compositionId)) throw new Error('Invalid Remotion composition ID');
  const root = await realpath(workspaceRoot);
  const bundle = assertWorkspacePath(root, resolve(bundleDirectory));
  const props = assertWorkspacePath(root, resolve(propsFile));
  const output = assertWorkspacePath(root, resolve(outputFile));
  if (!output.endsWith('.mp4') || basename(output).startsWith('.')) throw new Error('Invalid Remotion output file');
  for (const candidate of [bundle, props, output]) {
    if (candidate === root) throw new Error('Remotion path cannot be workspace root');
    let cursor = root;
    for (const segment of relative(root, candidate).split(/[\\/]/).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Remotion path contains symlink');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  if (!(await stat(bundle)).isDirectory()) throw new Error('Remotion bundle must be a directory');
  const propsInfo = await stat(props);
  if (!propsInfo.isFile() || propsInfo.size < 2 || propsInfo.size > 1_000_000) {
    throw new Error('Remotion props must be a bounded JSON file');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(props, 'utf8')); }
  catch { throw new Error('Invalid Remotion props JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Remotion props must be a JSON object');
  }
  const payload=parsed as Record<string,unknown>;
  if (!Number.isInteger(payload.fps) || !Number.isInteger(payload.durationInFrames) ||
      !Array.isArray(payload.layers) || payload.layers.length > 500) {
    throw new Error('Invalid Remotion render metadata');
  }
  for (const layer of payload.layers as Array<Record<string,unknown>>) {
    if (!layer || typeof layer !== 'object') throw new Error('Invalid Remotion layer');
    if (layer.type !== 'text' && (typeof layer.src !== 'string' ||
        !/^\\/assets\\/[a-zA-Z0-9_-]+\\.[a-zA-Z0-9]+$/.test(layer.src))) {
      throw new Error('Remotion media must be staged in trusted bundle assets');
    }
  }
  // No runtime npx/package downloads. The caller owns authorization, quotas,
  // isolation, and a unique output path. The CLI must already be installed.
  const result = await runVideoTool('remotion', [
    'render', bundle, 'NivooStudio', output,
    '--props', props, '--codec', 'h264',
  ], root, 3_600_000, signal);
  if (result.exitCode !== 0) throw new Error('Remotion render failed with exit ' + result.exitCode);
  const actualOutput = await realpath(output);
  if (actualOutput !== output) throw new Error('Unexpected Remotion output path');
  const outputInfo = await stat(actualOutput);
  if (!outputInfo.isFile() || outputInfo.size < 1024) throw new Error('Remotion output is empty or invalid');
  return result;
}
