import { cliReadOnly,codexLocalArgs,CLAUDE_READ_TOOLS,CLAUDE_EDIT_TOOLS,geminiSessionSettings } from '../../src/providers/cli-session-policy';
import { nativeSkillReadObserver } from '../../src/providers/cli-skill-observer';
import { ferramentasDaIa } from '../../src/providers/ferramentas';

describe('CLI local permission contract',()=>{
  it('selects read-only in planning and explicit review, not ordinary approved execution',()=>{
    expect(cliReadOnly({jobId:'conversa'})).toBe(true);
    expect(cliReadOnly({jobId:'job',options:{readOnlyReview:true}})).toBe(true);
    expect(cliReadOnly({jobId:'job',options:{}})).toBe(false);
    expect(codexLocalArgs('/work',true)).toContain('read-only');
    expect(codexLocalArgs('/work',false)).toContain('workspace-write');
    expect(codexLocalArgs('/work',true)).toContain('approval_policy="never"');
    expect(codexLocalArgs('/work',true)).not.toContain('danger-full-access');
    expect(CLAUDE_READ_TOOLS).toEqual(['Read','Glob','Grep']);
    expect(CLAUDE_EDIT_TOOLS).toContain('Edit');
  });
  it('constructs fresh Gemini settings with an explicit phase-specific allowlist',()=>{
    const read=geminiSessionSettings(true),edit=geminiSessionSettings(false,{docs:{httpUrl:'https://example.invalid'}});
    expect(read.tools.core).toContain('read_file');
    expect(read.tools.core).not.toContain('write_file');
    expect(read.tools.core).not.toContain('replace');
    expect(edit.tools.core).toContain('write_file');
    expect(edit.tools.core).toContain('replace');
    for(const s of [read,edit]){
      expect(s.tools.core).not.toContain('run_shell_command');
      expect(s.tools.exclude).toContain('run_shell_command');
      expect(s.advanced.ignoreLocalEnv).toBe(true);
    }
    expect(read.mcpServers).toEqual({});
    expect(edit.mcpServers).toHaveProperty('docs');
    expect(geminiSessionSettings(false).mcpServers).toEqual({});
  });
  it('does not instruct the planner to modify local files or use the removal journal',()=>{
    for(const id of ['codex-cli','claude-code-cli','gemini-api','nvidia-api','openrouter-free-api','groq-free-api']){
      const prompt=ferramentasDaIa(id,[],true).join('\n');
      expect(prompt).toContain('somente leitura');
      expect(prompt).not.toContain('.nivoo/remover.txt');
      expect(prompt).not.toContain('APAGAR OU MOVER');
    }
    expect(ferramentasDaIa('codex-cli',[],false).join('\n')).toContain('apply_patch');
  });
});
describe('Native CLI skill read receipts',()=>{
  const file='contexto/skills-nivoo/codigo/SKILL.md';
  it('correlates Claude Read with successful result, not an attempted or denied read',()=>{
    const log=jest.fn(),observe=nativeSkillReadObserver('claude','/work',log);
    const request=(id:string,file_path:string)=>observe(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id,name:'Read',input:{file_path}}]}}));
    const result=(id:string,is_error:boolean)=>observe(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,is_error,content:'PRIVATE CONTENT'}]}}));
    request('1',file);expect(log).not.toHaveBeenCalled();
    result('1',true);expect(log).not.toHaveBeenCalled();
    request('2','/work/'+file);result('2',false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(file);
    expect(log.mock.calls[0][0]).not.toContain('PRIVATE CONTENT');
    request('3','/outside/'+file);result('3',false);
    request('4',file);result('4',false);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('correlates Gemini result by tool ID and ignores unrelated or failed results',()=>{
    const log=jest.fn(),observe=nativeSkillReadObserver('gemini','/work',log);
    const request=(id:string)=>observe(JSON.stringify({type:'tool_use',tool_name:'read_file',tool_id:id,parameters:{file_path:file}}));
    const result=(id:string,status:string)=>observe(JSON.stringify({type:'tool_result',tool_id:id,status,output:'PRIVATE'}));
    request('x');result('wrong','success');result('x','error');
    expect(log).not.toHaveBeenCalled();
    request('y');result('y','success');
    expect(log).toHaveBeenCalledTimes(1);expect(log.mock.calls[0][0]).toContain(file);expect(log.mock.calls[0][0]).not.toContain('PRIVATE');
  });
});
