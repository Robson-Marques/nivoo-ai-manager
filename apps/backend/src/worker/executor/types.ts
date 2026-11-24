export type ExecutionLog=(message:string,level?:'INFO'|'WARN'|'ERROR',attemptId?:string)=>Promise<unknown>;
