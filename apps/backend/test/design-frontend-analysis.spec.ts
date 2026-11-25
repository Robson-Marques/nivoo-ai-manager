import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectFrontend } from '../src/design-studio/frontend-analysis';
describe('Design Studio read-only local inventory',()=>{
  it('uses the committed main tree, ignores untracked files and keeps Git unchanged',async()=>{
    const repo=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-design-analysis-'));
    const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
    try{
      git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
      fs.mkdirSync(path.join(repo,'src/pages'),{recursive:true});
      fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({dependencies:{react:'18',vite:'6'}}));
      fs.writeFileSync(path.join(repo,'src/pages/Home.tsx'),'export const Home=()=>null;');
      git('add','.');git('commit','-qm','initial');const head=git('rev-parse','HEAD');
      fs.writeFileSync(path.join(repo,'untracked.vue'),'not committed');const status=git('status','--porcelain');
      const a=await inspectFrontend(repo);
      expect(a.commit).toBe(head);expect(a.technologies.map(t=>t.name)).toEqual(expect.arrayContaining(['React','Vite']));
      expect(a.technologies.map(t=>t.name)).not.toContain('Vue');expect(a.pages.examples).toContain('src/pages/Home.tsx');
      expect(git('rev-parse','HEAD')).toBe(head);expect(git('status','--porcelain')).toBe(status);
    }finally{fs.rmSync(repo,{recursive:true,force:true});}
  });
});
