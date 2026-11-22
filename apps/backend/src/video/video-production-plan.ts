/**
 * OpenMontage-inspired production planning contract.
 * This is an independent Nivoo implementation; no external source is copied.
 * Plans are advisory and do not enqueue jobs or change renderer selection.
 */
export type VideoProductionStage =
  | 'inspect-media' | 'transcribe' | 'plan-scenes' | 'prepare-assets'
  | 'compose' | 'render' | 'quality-review';

export type VideoRenderEngine = 'remotion' | 'hyperframes' | 'ffmpeg';

export type VideoProductionPlan = {
  schemaVersion: 1;
  projectId: string;
  revision: string;
  renderEngine: VideoRenderEngine;
  stages: VideoProductionStage[];
  budgetCents: number;
  currency: 'BRL' | 'USD';
  requiresApprovalAboveCents: number;
};

const ORDER: VideoProductionStage[] = [
  'inspect-media', 'transcribe', 'plan-scenes', 'prepare-assets',
  'compose', 'render', 'quality-review',
];

export function validateVideoProductionPlan(plan: VideoProductionPlan): void {
  if (!plan || plan.schemaVersion !== 1 ||
      typeof plan.projectId !== 'string' || !plan.projectId.trim() || plan.projectId.length > 256 ||
      typeof plan.revision !== 'string' || !plan.revision.trim() || plan.revision.length > 256 ||
      !['remotion', 'hyperframes', 'ffmpeg'].includes(plan.renderEngine) ||
      !['BRL', 'USD'].includes(plan.currency) ||
      !Number.isSafeInteger(plan.budgetCents) || plan.budgetCents < 0 ||
      !Number.isSafeInteger(plan.requiresApprovalAboveCents) || plan.requiresApprovalAboveCents < 0 ||
      !Array.isArray(plan.stages) || plan.stages.length === 0 ||
      plan.stages.some(stage => !ORDER.includes(stage)) ||
      new Set(plan.stages).size !== plan.stages.length ||
      plan.stages.some((stage, index) => index > 0 && ORDER.indexOf(stage) <= ORDER.indexOf(plan.stages[index - 1])) ||
      !plan.stages.includes('render') || !plan.stages.includes('quality-review')) {
    throw new Error('Invalid video production plan');
  }
}

export type ProductionCheckpoint = {
  stage: VideoProductionStage;
  revision: string;
  artifactId: string;
  completedAt: number;
};

export function pendingProductionStages(
  plan: VideoProductionPlan,
  checkpoints: readonly ProductionCheckpoint[],
): VideoProductionStage[] {
  validateVideoProductionPlan(plan);
  const completed = new Set<VideoProductionStage>();
  for (const checkpoint of checkpoints) {
    if (!checkpoint || !plan.stages.includes(checkpoint.stage) ||
        checkpoint.revision !== plan.revision ||
        typeof checkpoint.artifactId !== 'string' || !checkpoint.artifactId ||
        !Number.isSafeInteger(checkpoint.completedAt) || checkpoint.completedAt < 0 ||
        completed.has(checkpoint.stage)) {
      throw new Error('Invalid or stale production checkpoint');
    }
    completed.add(checkpoint.stage);
  }
  // A later stage must never be resumed if an earlier stage lacks a checkpoint.
  let firstMissing = plan.stages.findIndex(stage => !completed.has(stage));
  if (firstMissing === -1) return [];
  if (plan.stages.slice(firstMissing + 1).some(stage => completed.has(stage))) {
    throw new Error('Production checkpoints are out of order');
  }
  return plan.stages.slice(firstMissing);
}

export function assertProductionSpend(
  plan: VideoProductionPlan,
  spentCents: number,
  proposedCents: number,
  approved: boolean,
): void {
  validateVideoProductionPlan(plan);
  if (!Number.isSafeInteger(spentCents) || spentCents < 0 ||
      !Number.isSafeInteger(proposedCents) || proposedCents < 0) {
    throw new Error('Invalid production spend');
  }
  const total = spentCents + proposedCents;
  if (!Number.isSafeInteger(total)) throw new Error('Invalid production spend total');
  if (total > plan.budgetCents) throw new Error('Video production budget exceeded');
  // Fail-closed: quando o gasto ACUMULADO (gasto+proposto) cruza o limite, exige aprovação do usuário.
  if (total > plan.requiresApprovalAboveCents && !approved) {
    throw new Error('Video production expense requires approval');
  }
}
