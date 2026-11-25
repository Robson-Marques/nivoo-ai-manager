/** Adapt only a recognized Vite production build, never arbitrary shell commands.
 * npm forwards the extra CLI arguments to the final command of a package script.
 * The caller runs this exclusively in the disposable preview worktree. */
export function adaptarBuildVite(instalar:string|undefined,build:unknown,base:string|undefined):string|undefined {
  if(!instalar||!base||!/^\/previa\/[a-f0-9]{48}\/$/.test(base)||typeof build!=='string')return instalar;
  // Common scripts: vite build, tsc --noEmit && vite build, tsc -b && vite build.
  // Leave custom shell constructs and existing explicit --base options untouched.
  if(!/^(?:tsc(?: [\w.-]+)* && )?vite build(?: --(?:mode|outDir|config) [\w./-]+)*$/.test(build.trim()))return instalar;
  const last=/(^| && )(npm run build|pnpm run build|yarn run build|yarn build)\s*$/;
  if(!last.test(instalar))return instalar;
  return instalar.replace(last,(_match:string,prefix:string,cmd:string)=>prefix+cmd+(cmd.startsWith('npm ')||cmd.startsWith('pnpm ')?' --':'')+' --base "'+base+'"');
}
