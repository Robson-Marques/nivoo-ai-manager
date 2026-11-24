import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as TS from 'typescript';
import { writeSessionContextFile } from '../../common/session-context-file';

const EXCLUDED=/^(?:node_modules|dist|build|coverage|vendor|target|out|midia|contexto|__pycache__|venv|\.git|\.nivoo)$/i;
const SECRET=/^(?:segredos\.json|conexoes\.json|id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
const SOURCE=/\.(?:[cm]?[jt]sx?)$/i;
const MANIFEST=/^(?:package\.json|tsconfig(?:\..*)?\.json|pyproject\.toml|requirements(?:[-.]\w+)?\.txt|go\.mod|Cargo\.toml|composer\.json|Gemfile|pom\.xml|build\.gradle(?:\.kts)?|Dockerfile|docker-compose\.ya?ml|schema\.prisma)$/i;
const DOC=/^(?:README|ARCHITECTURE|BLUEPRINT|CONTRIBUTING|ARQUITETURA)(?:[._-].*)?$/i;
const MAX_ENTRIES=12000, MAX_SOURCE=450, MAX_BYTES=8*1024*1024;
type Inventory={files:string[];partial:boolean};
type Edge={from:string;to:string;specifier:string};

function inventory(root:string):Inventory{
  const files:string[]=[];
  let visited=0,partial=false;
  function walk(dir:string,rel:string,depth:number):void{
    if(depth>24){partial=true;return;}
    let entries:fs.Dirent[];
    try{entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));}
    catch{partial=true;return;}
    for(const e of entries){
      if(++visited>MAX_ENTRIES){partial=true;return;}
      if(e.name.startsWith('.')||EXCLUDED.test(e.name)||SECRET.test(e.name)||/[\x00-\x1f]/.test(e.name)||e.isSymbolicLink())continue;
      const p=rel?rel+'/'+e.name:e.name;
      if(e.isDirectory())walk(path.join(dir,e.name),p,depth+1);
      else if(e.isFile()&&!/\.(?:pem|key|p12|pfx)$/i.test(e.name))files.push(p);
      if(visited>MAX_ENTRIES)return;
    }
  }
  walk(root,'',0);
  return {files,partial};
}

/** Exact paths or unique basenames only; ambiguous basenames are not guessed. */
export function architectureTargets(text:string,files:readonly string[]):{targets:string[];ambiguous:string[]}{
  const lookup=new Set(files);
  const byName=new Map<string,string[]>();
  for(const f of files){
    const name=path.posix.basename(f);
    const list=byName.get(name)??[];
    list.push(f);byName.set(name,list);
  }
  const targets=new Set<string>(),ambiguous=new Set<string>();
  for(const raw of text.split(/[\s"'`<>()\[\]{},;]+/)){
    const token=raw.replace(/^\.\//,'').replace(/:\d+(?::\d+)?$/,'').replace(/[.!?]+$/,'');
    if(!/\.[a-z0-9]{1,12}$/i.test(token)||token.startsWith('/')||token.split('/').includes('..'))continue;
    if(lookup.has(token))targets.add(token);
    else if(!token.includes('/')){
      const matches=byName.get(token)??[];
      if(matches.length===1)targets.add(matches[0]);
      else if(matches.length>1)ambiguous.add(token+': '+matches.slice(0,10).join(', ')+(matches.length>10?' …':''));
    }
    if(targets.size>=12)break;
  }
  return {targets:[...targets],ambiguous:[...ambiguous].slice(0,12)};
}
function resolveRelative(from:string,specifier:string,files:Set<string>):string|undefined{
  if(!specifier.startsWith('./')&&!specifier.startsWith('../'))return undefined;
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(from),specifier));
  if(base==='..'||base.startsWith('../'))return undefined;
  if(files.has(base))return base;
  const stem=base.replace(/\.(?:mjs|cjs|js|jsx)$/i,'');
  const options=new Set<string>();
  for(const ext of ['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs','.json']){
    for(const p of [stem+ext,base+'/index'+ext])if(files.has(p))options.add(p);
  }
  return options.size===1?[...options][0]:undefined;
}
function staticEdges(root:string,files:string[],targets:string[]):{edges:Edge[];scanned:number;partial:boolean;parser:boolean}{
  let ts:typeof TS;
  try{ts=require('typescript') as typeof TS;}catch{return {edges:[],scanned:0,partial:true,parser:false};}
  const set=new Set(files),target=new Set(targets),dirs=new Set(targets.map(f=>path.posix.dirname(f)));
  const ordered=files.filter(f=>SOURCE.test(f)).sort((a,b)=>{
    const rank=(f:string)=>target.has(f)?0:dirs.has(path.posix.dirname(f))?1:2;
    return rank(a)-rank(b)||a.localeCompare(b);
  });
  const edges:Edge[]=[];
  let bytes=0,scanned=0,partial=false;
  for(const from of ordered){
    if(scanned>=MAX_SOURCE||bytes>=MAX_BYTES){partial=true;break;}
    const file=path.join(root,from);
    let source:string;
    try{
      const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
      try{
        const st=fs.fstatSync(fd);
        if(!st.isFile()||st.size>256*1024||bytes+st.size>MAX_BYTES){partial=true;continue;}
        const b=Buffer.alloc(st.size);
        let n=0;
        while(n<b.length){const count=fs.readSync(fd,b,n,b.length-n,n);if(!count)break;n+=count;}
        bytes+=n;
        if(n!==st.size){partial=true;continue;}
        source=b.toString('utf8');
        if(b.includes(0)||!Buffer.from(source,'utf8').equals(b)){partial=true;continue;}
      }finally{fs.closeSync(fd);}
    }catch{partial=true;continue;}
    const ast=ts.createSourceFile(from,source,ts.ScriptTarget.Latest,true);
    scanned++;
    const add=(node:TS.Node|undefined)=>{
      if(!node||!ts.isStringLiteralLike(node))return;
      const to=resolveRelative(from,node.text,set);
      if(to&&(target.has(from)||target.has(to)))edges.push({from,to,specifier:node.text});
    };
    const walk=(node:TS.Node):void=>{
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))add(node.moduleSpecifier);
      else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))add(node.moduleReference.expression);
      else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require')))add(node.arguments[0]);
      ts.forEachChild(node,walk);
    };
    try{walk(ast);}catch{partial=true;}
  }
  return {edges:[...new Map(edges.map(e=>[JSON.stringify(e),e])).values()],scanned,partial,parser:true};
}

/** Deterministic navigation aid, not a semantic dependency graph or a review.
 * Uses the actual disposable planner copy or current job worktree. */
export function architectureContext(worktree:string|undefined,task:string):string[]{
  if(!worktree)return [];
  try{
    const root=fs.realpathSync(worktree);
    const {files,partial}=inventory(root);
    const {targets,ambiguous}=architectureTargets(task,files);
    const graph=targets.length?staticEdges(root,files,targets):null;
    const manifests=files.filter(f=>MANIFEST.test(path.posix.basename(f)));
    const docs=files.filter(f=>DOC.test(path.posix.basename(f)));
    const lines=[
      '# Mapa de navegação do workspace atual',
      'Inventário de caminhos reais; não comprova semântica, qualidade, leitura de implementação ou build.',
      'Pastas de dependências, saídas, contexto, links, arquivos ocultos e nomes sensíveis conhecidos foram excluídos.',
      'Inventário: '+files.length+' arquivos'+(partial?' (parcial; limite ou pasta inacessível)':' (dentro do escopo pesquisado)'),
      '', '## Manifestos e configurações encontrados',...manifests.map(f=>'- '+f),
      '', '## Documentação arquitetural encontrada',...docs.map(f=>'- '+f),
      '', '## Arquivos citados na tarefa',...targets.map(f=>'- '+f),...ambiguous.map(f=>'- Nome ambíguo: '+f),
      ...(graph?['','## Referências estáticas diretas JS/TS',
        'Parser TypeScript '+(graph.parser?'disponível; '+graph.scanned+' fontes examinadas':'indisponível')+(graph.partial?'; cobertura parcial':'')+'. Somente imports/exports/require literais relativos resolvidos de forma única. Aliases, injeção de dependências, reflexão, rotas e outras linguagens exigem leitura própria.',
        ...graph.edges.map(e=>'- '+e.from+' -> '+e.to+' (referência '+JSON.stringify(e.specifier)+')')]:['','Sem alvo de arquivo explícito: não foi feita varredura de imports.']),
      '', '## Inventário de caminhos',...files.map(f=>'- '+f),
    ];
    // Bound file size below hosted read limit even for unusually long path names.
    const pages:string[]=[];
    let page='';
    for(const line of lines){
      if(Buffer.byteLength(page)+Buffer.byteLength(line)+1>240000){
        const rel='acervo/arquitetura-'+String(pages.length+1).padStart(3,'0')+'.md';
        writeSessionContextFile(root,rel,page);pages.push('contexto/'+rel);page='';
      }
      page+=line+'\n';
    }
    if(page){
      const rel='acervo/arquitetura-'+String(pages.length+1).padStart(3,'0')+'.md';
      writeSessionContextFile(root,rel,page);pages.push('contexto/'+rel);
    }
    writeSessionContextFile(root,'acervo/arquitetura-indice.md',['# Páginas do mapa de navegação',...pages.map(p=>'- '+p)].join('\n')+'\n');
    return ['## Navegação de engenharia (workspace atual)',
      'Mapa local: contexto/acervo/arquitetura-indice.md. '+files.length+' caminhos'+(partial?' (inventário parcial)':'')+'.',
      'Antes de propor ou editar, leia os manifestos/Blueprint relevantes, o arquivo responsável por inteiro, seus contratos e os consumidores afetados. O mapa apenas orienta essa leitura. Se um arquivo tiver paginação, leia até o fim pertinente; não conclua a partir de grep ou nomes.',
      'Confirme referências dinâmicas e aliases nas fontes e configurações; ausência no mapa não prova ausência de dependência. Não crie uma etapa de relatório ou revisão só para cumprir esta orientação.',
      ...(targets.length?['Alvos encontrados: '+targets.join(', ')]:[]),
      ...(graph?.partial?['A análise estática de referências é parcial.']:[])];
  }catch{
    // A navigation aid must not block the real work. No filesystem errors or
    // paths from outside the workspace are echoed into the prompt.
    return ['## Navegação de engenharia','Mapa auxiliar indisponível. Leia diretamente os manifestos, implementações e consumidores com as ferramentas autorizadas; não invente dependências.'];
  }
}
