import { lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { assertWorkspacePath, runVideoTool, ToolResult } from './video-tool-adapters';

/**
 * Render an existing, trusted HyperFrames project.
 * Project creation and generated HTML/JS are deliberately outside this adapter:
 * only server-owned projects may be executed by the isolated worker.
 */
export async function renderHyperFramesProject(
  workspaceRoot: string,
  projectDirectory: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const root = await realpath(workspaceRoot);
  const project = await realpath(projectDirectory);
  assertWorkspacePath(root, project);
  if (project === root) throw new Error('HyperFrames project must be a subdirectory');
  if (!(await stat(project)).isDirectory()) throw new Error('HyperFrames project must be a directory');
  const rel = relative(root, project);
  let current = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('HyperFrames project path contains symlink');
  }
  // Never use npx here: it may download and execute an unpinned package at runtime.
  // The worker host must provision the HyperFrames CLI in advance.
  return runVideoTool('hyperframes', ['render'], project, 3_600_000, signal);
}

/** Prepare a new isolated output directory under an already-authorized workspace. */
export async function prepareHyperFramesOutput(workspaceRoot: string, outputName: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(outputName)) throw new Error('Invalid output name');
  const root = await realpath(workspaceRoot);
  const target = assertWorkspacePath(root, resolve(root, 'hyperframes-output', outputName));
  await mkdir(target, { recursive: true });
  if (assertWorkspacePath(root, await realpath(target)) !== target) throw new Error('Output path is not isolated');
  return target;
}
