import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { VideoComposition } from './video-composition';
import { buildRemotionProps, RemotionProps } from './video-remotion-props';
import { ProjectMediaRecord, resolveCompositionMedia } from './video-project-media';
import { assertRendererParity, RenderFeatureSupport } from './video-render-parity';
import { renderRemotionComposition } from './video-remotion-runner';
import { inspectRenderedVideo } from './video-render-inspection';
import { assertWorkspacePath } from './video-tool-adapters';

export type VerifiedRemotionRender = {
  outputFile: string;
  durationMs: number;
  hasAudio: boolean;
  blackFrameCount: number;
  audioPeakDbfs?: number;
};

/**
 * Actual adapter composition: project-owned media -> renderer props ->
 * pre-provisioned Remotion CLI -> independently inspected MP4.
 * Feature parity is required and cannot be inferred from props alone.
 * The caller must provide a trusted pre-built bundle and a unique output path.
 */
export async function executeVerifiedRemotionRender(
  input: {
    workspaceRoot: string;
    bundleDirectory: string;
    composition: VideoComposition;
    projectId: string;
    projectMedia: readonly ProjectMediaRecord[];
    outputFile: string;
    propsFile: string;
    supportedFeatures: RenderFeatureSupport;
  },
  signal?: AbortSignal,
): Promise<VerifiedRemotionRender> {
  if (!input || !input.supportedFeatures) throw new Error('Renderer capabilities not verified');
  assertRendererParity(input.composition, input.supportedFeatures);
  const resolved = resolveCompositionMedia(input.composition, input.projectId, input.projectMedia);
  const props: RemotionProps = buildRemotionProps(input.composition, resolved);
  const propsFile = assertWorkspacePath(input.workspaceRoot, resolve(input.propsFile));
  if (!propsFile.endsWith('.json')) throw new Error('Invalid Remotion props output');
  const root = await realpath(input.workspaceRoot);
  const relativeProps = relative(root, propsFile);
  let cursor = root;
  for (const segment of relativeProps.split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Remotion props path contains symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await mkdir(dirname(propsFile), { recursive: true });
  // Retry-safe: reuse only byte-identical props. A stale revision or altered
  // payload must fail closed instead of silently rendering old instructions.
  const serialized = JSON.stringify(props);
  try {
    await writeFile(propsFile, serialized, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(propsFile, 'utf8');
    if (existing !== serialized) throw new Error('Stale or conflicting Remotion props file');
  }
  const stored = JSON.parse(await readFile(propsFile, 'utf8')) as RemotionProps;
  if (stored.compositionId !== input.composition.id || stored.revision !== input.composition.revision) {
    throw new Error('Remotion props revision mismatch');
  }
  await renderRemotionComposition(input.workspaceRoot, input.bundleDirectory,
    input.composition.id, propsFile, input.outputFile, signal);
  const inspected = await inspectRenderedVideo(input.workspaceRoot, input.outputFile, signal);
  if (!inspected.outputExists || inspected.durationMs === undefined ||
      inspected.hasAudio === undefined || inspected.blackFrameCount === undefined) {
    throw new Error('Remotion output inspection incomplete');
  }
  return {
    outputFile: input.outputFile,
    durationMs: inspected.durationMs,
    hasAudio: inspected.hasAudio,
    blackFrameCount: inspected.blackFrameCount,
    ...(inspected.audioPeakDbfs !== undefined ? { audioPeakDbfs: inspected.audioPeakDbfs } : {}),
  };
}
