/** Local filesystem permission mode, shared by the normal CLI adapters.
 * Goldfish uses its own tool-free transport. MCP permissions are separate
 * and must not be inferred from the local filesystem mode. */
export function cliReadOnly(req:{jobId:string;options?:Record<string,unknown>}):boolean{
  return req.jobId==='conversa'||req.options?.readOnlyReview===true;
}
export const CLAUDE_READ_TOOLS=['Read','Glob','Grep'] as const;
export const CLAUDE_EDIT_TOOLS=[...CLAUDE_READ_TOOLS,'Edit','Write'] as const;
export const GEMINI_READ_TOOLS=['read_file','read_many_files','list_directory','glob','grep_search','search_file_content'] as const;
export const GEMINI_EDIT_TOOLS=[...GEMINI_READ_TOOLS,'write_file','replace'] as const;
export function codexLocalArgs(cwd:string,readOnly:boolean):string[]{
  return ['exec','--json','--sandbox',readOnly?'read-only':'workspace-write','--skip-git-repo-check','-c','project_doc_max_bytes=0','-c','approval_policy="never"','-C',cwd];
}
export function geminiSessionSettings(readOnly:boolean,mcpServers:Record<string,unknown>={}){
  return {
    security:{auth:{selectedType:'gemini-api-key'}},
    tools:{core:[...(readOnly?GEMINI_READ_TOOLS:GEMINI_EDIT_TOOLS)],exclude:['run_shell_command','web_fetch','google_web_search']},
    general:{enableAutoUpdate:false},
    privacy:{usageStatisticsEnabled:false},
    advanced:{ignoreLocalEnv:true},
    mcpServers,
  };
}
