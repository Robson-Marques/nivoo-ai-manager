import { makeRemodelPlan,validateScope } from '../src/design-studio/remodel-plan';
import { defaultVisual } from '../src/design-studio/visual';
import type { DesignProfile } from '../src/design-studio/design-profile.store';
const p:DesignProfile={schemaVersion:1,id:'p',projectId:'project',title:'ERP',mode:'remodel',sourceId:'asimov-glass',theme:'dark',revision:2,visual:defaultVisual,createdAt:'',updatedAt:''};
describe('Design remodel plan',()=>{
  it('uses exact tokens, current engine and selected project scope',()=>{
    const scope=validateScope({kind:'selected',paths:['src/pages/Home.tsx'],notes:'preservar filtros'},['src/pages/Home.tsx']);
    const plan=makeRemodelPlan(p,'abc',scope,'codex-cli',[{nome:'liquid-glass.js',contentBase64:Buffer.from('test').toString('base64')}]);
    expect(plan.defaultProvider).toBe('codex-cli');
    expect(plan.objective).toContain('src/pages/Home.tsx');
    expect(plan.objective).toContain(defaultVisual.darkColors.primary);
    expect(plan.objective).toContain('SHA256');
    expect(plan.steps).toHaveLength(1);
    expect(()=>makeRemodelPlan({...p,sourceId:'liqui'},'abc',scope,'codex-cli',[])).toThrow();
  });
  it('rejects paths not present in the current inventory',()=>{
    expect(()=>validateScope({kind:'selected',paths:['../../.env']},['src/pages/Home.tsx'])).toThrow();
    expect(validateScope({kind:'all'},[]).paths).toEqual([]);
  });
});
