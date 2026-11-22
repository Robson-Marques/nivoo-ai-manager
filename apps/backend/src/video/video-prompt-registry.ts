import { createHash } from 'node:crypto';
import { VideoProductionStage } from './video-production-plan';

export type ProductionPrompt = {
  schemaVersion: 1;
  id: string;
  version: number;
  stage: VideoProductionStage;
  system: string;
  template: string;
  variables: string[];
};

const ALLOWED_VARIABLE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const TOKEN = /\{\{([a-z][a-zA-Z0-9_]{0,63})\}\}/g;

/**
 * Nivoo-owned prompt registry contract. The registry stores reviewed templates;
 * arbitrary user input is data, not executable instructions or code.
 */
export function validateProductionPrompt(prompt: ProductionPrompt): void {
  if (!prompt || prompt.schemaVersion !== 1 ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(prompt.id) ||
      !Number.isSafeInteger(prompt.version) || prompt.version < 1 ||
      !['inspect-media', 'transcribe', 'plan-scenes', 'prepare-assets',
        'compose', 'render', 'quality-review'].includes(prompt.stage) ||
      typeof prompt.system !== 'string' || prompt.system.length > 8000 ||
      typeof prompt.template !== 'string' || !prompt.template || prompt.template.length > 16000 ||
      !Array.isArray(prompt.variables) || prompt.variables.length > 40 ||
      prompt.variables.some(variable => typeof variable !== 'string' || !ALLOWED_VARIABLE.test(variable)) ||
      new Set(prompt.variables).size !== prompt.variables.length) {
    throw new Error('Invalid production prompt');
  }
  const used = new Set([...prompt.template.matchAll(TOKEN)].map(match => match[1]));
  if (used.size !== prompt.variables.length ||
      prompt.variables.some(variable => !used.has(variable)) ||
      /\{\{|\}\}/.test(prompt.template.replace(TOKEN, ''))) {
    throw new Error('Prompt template variables do not match declaration');
  }
}

export function renderProductionPrompt(
  prompt: ProductionPrompt,
  values: Record<string, string>,
): { system: string; user: string; fingerprint: string } {
  validateProductionPrompt(prompt);
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
      Object.keys(values).length !== prompt.variables.length ||
      Object.keys(values).some(key => !prompt.variables.includes(key)) ||
      Object.values(values).some(value => typeof value !== 'string' || value.length > 12000)) {
    throw new Error('Invalid production prompt values');
  }
  const user = prompt.template.replace(TOKEN, (_, name: string) => values[name]);
  const fingerprint = createHash('sha256').update(JSON.stringify([
    prompt.id, prompt.version, prompt.stage, prompt.system, prompt.template, values,
  ])).digest('hex');
  return { system: prompt.system, user, fingerprint };
}
