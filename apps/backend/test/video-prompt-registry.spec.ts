import { renderProductionPrompt, ProductionPrompt } from '../src/video/video-prompt-registry';

describe('versioned video prompt registry', () => {
  const prompt: ProductionPrompt = {
    schemaVersion: 1, id: 'scene-plan', version: 1, stage: 'plan-scenes',
    system: 'Plan scenes without inventing media.',
    template: 'Project {{project}}: narration {{narration}}',
    variables: ['project', 'narration'],
  };

  it('renders deterministically and changes fingerprint with revision', () => {
    const values = { project: 'Nivoo', narration: 'Olá' };
    const first = renderProductionPrompt(prompt, values);
    expect(first.user).toBe('Project Nivoo: narration Olá');
    expect(renderProductionPrompt(prompt, values).fingerprint).toBe(first.fingerprint);
    expect(renderProductionPrompt({ ...prompt, version: 2 }, values).fingerprint).not.toBe(first.fingerprint);
  });

  it('rejects undeclared tokens and missing variables', () => {
    expect(() => renderProductionPrompt({ ...prompt, template: '{{unknown}}' }, {
      project: 'Nivoo', narration: 'Olá',
    })).toThrow('variables');
    expect(() => renderProductionPrompt(prompt, { project: 'Nivoo' })).toThrow('values');
  });

  it('does not recursively expand variable content', () => {
    expect(renderProductionPrompt(prompt, {
      project: '{{narration}}', narration: 'texto',
    }).user).toBe('Project {{narration}}: narration texto');
  });
});
