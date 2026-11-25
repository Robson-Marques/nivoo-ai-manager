import { verificationProblem,verificationPassed,redactVerificationResult } from '../../src/common/verification-environment';
import type {RunResult} from '../../src/common/exec';
const result=(v:Partial<RunResult>={}):RunResult=>({exitCode:1,stdout:'',stderr:'',timedOut:false,aborted:false,durationMs:1,...v});
describe('Responsabilidade da falha de verificação',()=>{
  it('não trata timeout, abort ou falha de spawn como sucesso',()=>{
    expect(verificationPassed(result({exitCode:0}))).toBe(true);
    expect(verificationPassed(result({exitCode:0,timedOut:true}))).toBe(false);
    expect(verificationPassed(result({exitCode:0,aborted:true}))).toBe(false);
    expect(verificationPassed(result({exitCode:null,spawnError:'ENOENT'}))).toBe(false);
  });
  it('distingue infraestrutura, registro privado e defeito do projeto',()=>{
    expect(verificationProblem(result({stderr:'ENOSPC: no space left on device'}),'npm test')?.kind).toBe('infrastructure');
    expect(verificationProblem(result({stderr:'npm error code E401\n401 Unauthorized registry'}),'npm install')?.kind).toBe('credential');
    expect(verificationProblem(result({stderr:'HTTP 401 Unauthorized: login do cliente'}),'npm test')).toBeNull();
    expect(verificationProblem(result({exitCode:127,stderr:'bash: rg: command not found'}),'rg teste')?.kind).toBe('tool');
    expect(verificationProblem(result({exitCode:127,stderr:'sh: jest: not found'}),'npm test')).toBeNull();
  });
  it('remove valores conhecidos da saída persistida',()=>{
    const r=redactVerificationResult(result({stdout:'token segredo-xyz',stderr:'segredo-xyz'}),s=>s.replaceAll('segredo-xyz','[SEGREDO]'));
    expect(r.stdout).toBe('token [SEGREDO]');expect(r.stderr).toBe('[SEGREDO]');
  });
});
