import { lstat, realpath, stat } from 'node:fs/promises';
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
  if (!(await stat(props)).isFile() || !(await stat(props)).size) throw new Error('Remotion props must be a file');
  // No runtime npx/package downloads. The caller owns authorization, quotas,
  // isolation, and a unique output path. The CLI must already be installed.
  return runVideoTool('remotion', [
    'render', bundle, compositionId, output,
    '--props', props, '--codec', 'h264',
  ], root, 3_600_000, signal);
}
