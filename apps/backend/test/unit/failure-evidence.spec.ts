import { diagnoseAttempt } from '../../src/worker/executor/failure-evidence';
import { classifyExecutionResult,normalizeSessionResult } from '../../src/worker/executor/outcome';
import { verificationDiagnostic } from '../../src/worker/executor/verification-diagnostic';
import { verificationReceipt } from '../../src/specialties/skill-evidence';
import type { ExecutionResult } from '../../src/providers/provider.interface';
const normal:ExecutionResult={exitCode:0,output:'Implementation written'};
const failure:ExecutionResult={exitCode:1,output:'',error:'verificação da etapa falhou (exit 1): TypeError [ERR_INVALID_ARG_TYPE]'};
const checked=verificationReceipt('node nivoo-roteiros/despesas-postgres.cjs',1,false,false,false);
describe('Failure origin is separate from the execution outcome',()=>{
  it('classifies a normally completed AI session with failed verification as failure, not continuation',()=>{
    const session=normalizeSessionResult(normal,true);
    expect(classifyExecutionResult(failure,true,false,session.sessionClosedNormally).attemptStatus).toBe('FALHA');
    expect(diagnoseAttempt({result:failure,beforeVerification:normal,verification:checked,isAi:true,verified:false,attemptStatus:'FALHA'})).toMatchObject({layer:'verification',kind:'check-failed',detail:failure.error,verification:checked});
  });
  it('preserves real session exhaustion for continuation when the work is incomplete',()=>{
    const s=normalizeSessionResult({exitCode:1,output:'',error:'timeout após 1000 ms'},true);
    expect(s.result.sessionEnded).toBe(true);
    expect(classifyExecutionResult(s.result,true,false,s.sessionClosedNormally).attemptStatus).toBe('SESSAO_ENCERRADA');
    expect(diagnoseAttempt({result:s.result,beforeVerification:s.result,isAi:true,verified:false,attemptStatus:'SESSAO_ENCERRADA'})).toMatchObject({layer:'session',kind:'incomplete-session'});
  });
  it('never converts explicit spawn or connector failure to a code error',()=>{
    const spawn:ExecutionResult={exitCode:-1,output:'',error:'spawn bash ENOENT',connectorFailure:{kind:'spawn',detail:'spawn bash ENOENT'}};
    expect(diagnoseAttempt({result:spawn,beforeVerification:spawn,isAi:false,verified:false,attemptStatus:'FALHA'})).toMatchObject({layer:'connector',kind:'spawn'});
    const sandbox:ExecutionResult={...spawn,resourceUnavailable:true,connectorFailure:{kind:'sandbox',detail:'sandbox denied'}};
    expect(diagnoseAttempt({result:sandbox,beforeVerification:sandbox,isAi:true,verified:false,attemptStatus:'RECURSO_INDISPONIVEL'})).toMatchObject({layer:'connector',kind:'sandbox'});
  });
  it('attributes unavailable environment and credentials to the verification stage',()=>{
    const input={result:failure,beforeVerification:normal,isAi:true,verified:false,attemptStatus:'FALHA',verification:checked};
    expect(diagnoseAttempt({...input,environment:'PostgreSQL not available'})).toMatchObject({layer:'verification-environment',kind:'infrastructure'});
    expect(diagnoseAttempt({...input,credential:'Registry key absent'})).toMatchObject({layer:'verification-environment',kind:'credential'});
    expect(diagnoseAttempt({...input,tool:'ffmpeg'})).toMatchObject({layer:'verification-environment',kind:'tool'});
  });
  it('does not infer quota, credential, or infrastructure failure from project output',()=>{
    const b={...failure,output:'Tested HTTP 401, 429, ENOSPC'};
    expect(diagnoseAttempt({result:b,beforeVerification:b,isAi:true,verified:false,attemptStatus:'FALHA'})).toMatchObject({layer:'provider',kind:'unknown'});
    expect(diagnoseAttempt({result:{...b,resourceUnavailable:true},beforeVerification:{...b,resourceUnavailable:true},isAi:true,verified:false,attemptStatus:'RECURSO_INDISPONIVEL'})).toMatchObject({layer:'provider',kind:'resource'});
  });
  it('distinguishes check timeout, cancellation and postconditions from an ordinary test failure',()=>{
    const input={result:failure,beforeVerification:normal,isAi:true,verified:false,attemptStatus:'FALHA'};
    expect(diagnoseAttempt({...input,verification:verificationReceipt('test',null,false,false,true)})).toMatchObject({layer:'verification',kind:'timeout'});
    expect(diagnoseAttempt({...input,result:{...failure,interrupted:true},verification:verificationReceipt('test',null,false,true,false)})).toMatchObject({layer:'verification',kind:'interrupted'});
    expect(diagnoseAttempt({...input,result:{...failure,stopReason:'repair_no_change'}})).toMatchObject({layer:'postcondition',kind:'postcondition'});
    expect(diagnoseAttempt({...input,attemptStatus:'SUCESSO'})).toBeNull();
  });
  it('keeps the concrete exception and its caller when a later test reports a summary',()=>{
    const text='TypeError [ERR_INVALID_ARG_TYPE]: The "id" argument must be of type string. Received undefined\n    at require (node:internal/modules/helpers:135:16)\n    at Object.<anonymous> (/project/nivoo-roteiros/despesas-postgres.cjs:12:5)\nFAIL generic suite\nnpm error code ELIFECYCLE\nPASS unrelated suite';
    const diagnostic=verificationDiagnostic(text);
    expect(diagnostic).toContain('ERR_INVALID_ARG_TYPE');
    expect(diagnostic).toContain('despesas-postgres.cjs:12:5');
    expect(diagnostic).not.toContain('PASS unrelated suite');
    expect(diagnostic).not.toContain('ELIFECYCLE');
  });
});
