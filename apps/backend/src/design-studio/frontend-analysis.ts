import { BadRequestException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { minimalEnv } from '../common/exec';
const exec = promisify(execFile);
type Entry={path:string;size:number};
type Manifest={path:string;dependencies:Record<string,string>};
const ignored=/(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.git|\.nivoo|\.yarn|\.cache)(\/|$)/i;
const manifestNames=/(^|\/)package\.json$/;
const known:Record<string,string>={
  react:'React','react-dom':'React',next:'Next.js',vue:'Vue',nuxt:'Nuxt','@angular/core':'Angular',svelte:'Svelte','@sveltejs/kit':'SvelteKit',astro:'Astro',vite:'Vite','@remix-run/react':'Remix',tailwindcss:'Tailwind CSS','@mui/material':'Material UI','@fluentui/react-components':'Fluent UI',antd:'Ant Design','@mantine/core':'Mantine','@carbon/react':'Carbon','@chakra-ui/react':'Chakra UI',bootstrap:'Bootstrap','react-bootstrap':'React Bootstrap','react-router-dom':'React Router',typescript:'TypeScript',jquery:'jQuery'
};
export function summarizeFrontend(entries:Entry[],manifests:Manifest[]){
  const paths=entries.map(e=>e.path).filter(p=>!ignored.test(p));
  const technologies=new Map<string,Set<string>>();
  const register=(name:string,evidence:string)=>{const set=technologies.get(name)??new Set<string>();set.add(evidence);technologies.set(name,set);};
  for(const m of manifests)for(const name of Object.keys(m.dependencies)){
    if(known[name])register(known[name],m.path+' · '+name);
    if(name.startsWith('@radix-ui/'))register('Radix UI',m.path+' · '+name);
  }
  const detect=(name:string,re:RegExp)=>{const p=paths.find(x=>re.test(x));if(p)register(name,p);};
  detect('Vue',/\.vue$/i);detect('Svelte',/\.svelte$/i);detect('Astro',/\.astro$/i);
  detect('Next.js',/(^|\/)next\.config\.[a-z]+$/i);detect('Angular',/(^|\/)angular\.json$/i);
  detect('Laravel Blade',/\.blade\.php$/i);detect('Django/Jinja (indício)',/(^|\/)templates\/.*\.html$/i);
  detect('HTML',/\.html?$/i);
  const frontendFiles=paths.filter(p=>/\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|blade\.php)$/i.test(p)||/\.component\.ts$/i.test(p));
  const pages=frontendFiles.filter(p=>/(^|\/)(pages|routes|views|screens|templates)\//i.test(p)||/(^|\/)(page|layout|route)\.(tsx|jsx|vue|svelte|astro)$/i.test(p)||/\.component\.ts$/i.test(p));
  const components=frontendFiles.filter(p=>/(^|\/)(components|widgets|ui)\//i.test(p)||/\.component\.ts$/i.test(p));
  const styles=frontendFiles.filter(p=>/\.(css|scss|sass|less)$/i.test(p));
  const configs=paths.filter(p=>/(^|\/)(package\.json|angular\.json|components\.json|(?:vite|next|nuxt|astro|svelte|tailwind|postcss)\.config\.[^/]+)$/i.test(p));
  const locks=paths.filter(p=>/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock)$/i.test(p));
  const scope=(items:string[])=>({count:items.length,examples:items.slice(0,80)});
  return {technologies:[...technologies.entries()].map(([name,evidence])=>({name,evidence:[...evidence].slice(0,12)})),manifests:manifests.map(m=>m.path),trackedFiles:paths.length,frontend:scope(frontendFiles),pages:scope(pages),components:scope(components),styles:scope(styles),configs:scope(configs),locks:scope(locks)};
}
/** Read only, from one immutable local Git commit. No checkout, remote, credentials, package scripts or repository changes. */
export async function inspectFrontend(repo:string){
  const git=async(args:string[],maxBuffer=12*1024*1024)=>{
    try{return (await exec('git',args,{cwd:repo,env:minimalEnv({GIT_TERMINAL_PROMPT:'0'}),timeout:20000,maxBuffer,encoding:'utf8'})).stdout;}
    catch{throw new BadRequestException('Não foi possível ler a versão local do projeto. Confira a pasta Git ou sincronize pela aba Git existente.');}
  };
  const commit=(await git(['rev-parse','--verify','refs/heads/main^{commit}'])).trim();
  if(!/^[a-f0-9]{40,64}$/i.test(commit))throw new BadRequestException('Commit local inválido');
  const raw=await git(['ls-tree','-r','-l','-z',commit]);
  const entries:Entry[]=[];
  for(const line of raw.split('\0')){
    const m=/^(100644|100755) blob [a-f0-9]+ +([0-9]+)\t([\s\S]+)$/.exec(line);
    if(m&&!ignored.test(m[3]))entries.push({path:m[3],size:Number(m[2])});
  }
  const candidates=entries.filter(e=>manifestNames.test(e.path)).sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path));
  const selected=candidates.filter(e=>e.size<=256*1024).slice(0,30);
  const manifests:Manifest[]=[];const unreadable:string[]=[];
  for(let i=0;i<selected.length;i+=5){
    const part=await Promise.all(selected.slice(i,i+5).map(async e=>{
      try{
        const obj=JSON.parse(await git(['cat-file','blob',commit+':'+e.path],512*1024));
        if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('manifest');
        const dependencies:Record<string,string>=Object.create(null);
        for(const key of ['dependencies','devDependencies','peerDependencies']){
          const d=obj[key];if(d&&typeof d==='object'&&!Array.isArray(d))for(const [k,v] of Object.entries(d))if(typeof v==='string')dependencies[k]=v;
        }
        return {path:e.path,dependencies};
      }catch{unreadable.push(e.path);return null;}
    }));
    for(const m of part)if(m)manifests.push(m);
  }
  return {commit,analyzedAt:new Date().toISOString(),...summarizeFrontend(entries,manifests),manifestCoverage:{total:candidates.length,read:manifests.length,omitted:candidates.length-selected.length,unreadable},limitations:['Análise estática dos arquivos versionados no commit local; não executa o software.','Páginas, componentes e rotas são candidatos identificados por convenção de arquivos, não rotas validadas em execução.','A branch remota pode estar mais recente; use a sincronização Git já existente quando necessário.']};
}
