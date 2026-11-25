import { BadRequestException } from '@nestjs/common';
import { DesignProfile } from './design-profile.store';
import { findDesignSource } from './catalog';
import { createHash } from 'node:crypto';

export const vendorFiles = {
  'liquid-glass':['liquid-glass.js','liquid-glass.css','LIQUID-GLASS-LICENSE.txt'],
  bootstrap:['bootstrap.css','BOOTSTRAP-LICENSE.txt'],
} as const;
export type RemodelScope={kind:'all'|'selected';paths:string[];notes:string};
export function validateScope(raw:unknown,available:string[]):RemodelScope {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new BadRequestException('Escopo inválido');
  const v=raw as Record<string,unknown>;
  if(v.kind!=='all'&&v.kind!=='selected')throw new BadRequestException('Selecione o escopo');
  const notes=typeof v.notes==='string'?v.notes.trim():'';
  if(notes.length>2000)throw new BadRequestException('Detalhes do escopo: máximo de 2.000 caracteres');
  if(v.kind==='all')return {kind:'all',paths:[],notes};
  if(!Array.isArray(v.paths)||!v.paths.length||v.paths.length>80||v.paths.some(p=>typeof p!=='string'||!available.includes(p)))throw new BadRequestException('Selecione arquivos de interface do inventário atual');
  return {kind:'selected',paths:[...new Set(v.paths as string[])],notes};
}
export type DesignAttachment={nome:string;contentBase64:string};
export function makeRemodelPlan(profile:DesignProfile,commit:string,scope:RemodelScope,provider:string,assets:DesignAttachment[]){
  const source=findDesignSource(profile.sourceId);
  if(!source?.adapter||source.status!=='ready')throw new BadRequestException('Escolha um motor com prévia local disponível');
  const tokens=JSON.stringify({schemaVersion:1,profileId:profile.id,revision:profile.revision,theme:profile.theme,sourceId:source.id,visual:profile.visual},null,2);
  const hashes=assets.map(a=>a.nome+' SHA256 '+createHash('sha256').update(Buffer.from(a.contentBase64,'base64')).digest('hex')).join('\n');
  const objective=[
    'Remodelar o frontend existente usando a identidade visual selecionada no Studio de Design, sem alterar suas funcionalidades.',
    'Commit local analisado: '+commit+'. Este é o ponto de referência; se a base evoluiu, inspecione as mudanças antes de aplicar e não sobrescreva trabalho alheio.',
    'Motor: '+source.name+' | Fonte: '+source.url+' | Documentação: '+source.docs,
    'Escopo: '+(scope.kind==='all'?'frontend inteiro':scope.paths.join(', ')),
    'Detalhes do usuário: '+(scope.notes||'nenhum'),
    'Tokens aprovados (valores exatos, não reinterpretar):\n'+tokens,
    'Arquivos originais do motor anexados à conversa (preservar bytes e avisos de licença):\n'+hashes,
    'Preservar autenticação, autorização, rotas, APIs, dados, regras de negócio, validações e fluxos. Não recriar backend, integração Git, infraestrutura ou funcionalidades. Não trocar framework por conveniência.',
    'Use os componentes originais anexados e adapte sua integração ao framework existente; não simule Liquid Glass por blur/CSS próprio e não substitua biblioteca por outra. Se já existir a mesma biblioteca em versão compatível, reutilize sem instalar uma segunda cópia, registrando a versão.',
    'A prévia do Studio é um demonstrador dos componentes, não uma cópia das telas do software. Use o conteúdo e a estrutura funcional reais do projeto.',
  ].join('\n\n');
  const instructions=[
    'Implemente a remodelagem diretamente no worktree deste trabalho, dentro do escopo autorizado. Leia as regras do projeto e os anexos da conversa em contexto/anexos/. Não faça commit/push diretamente no remoto; o Nivoo já controla integração e publicação.',
    'Antes de editar, registre os fluxos e as telas afetadas. Se a prévia existente funcionar, capture as telas atuais usando os recursos já disponíveis no Nivoo e preserve as capturas como evidência antes/depois. Não invente evidências.',
    'Mapeie os tokens para o mecanismo visual existente, mantendo os valores de ambos os temas, e use o motor original para componentes compatíveis. Use o arquivo de licença junto aos ativos distribuídos. Não aplique CSS global que altere telas fora do escopo.',
    'Para escopo selecionado, altere somente os arquivos selecionados e os pontos compartilhados estritamente necessários para integrar os tokens; relate esses pontos e preserve o comportamento das demais telas.',
    'Execute os comandos de build/testes que o projeto já possui, proporcionalmente ao escopo. Use a prévia e ferramentas de captura/interação existentes quando disponíveis. Não crie CI novo nem um fluxo paralelo de conferência.',
    'Entregue código funcional, não apenas um mockup ou relatório. Grave out/remodelagem.md com arquivos alterados, aplicação dos tokens e motor, resultados reais dos testes/build, evidências antes/depois quando obtidas, limitações e funcionalidades preservadas. Se não conseguir implementar, não declare sucesso.',
  ].join('\n');
  // Check real frontend changes relative to the worktree fork point; include newly created files.
  // This is part of the existing step verification, not another review/CI phase.
  const verifyCommand=[
    'test -s out/remodelagem.md',
    'git diff --check',
    'git diff --check --cached',
    '{ git diff --name-only --no-renames "$(git merge-base HEAD refs/heads/main)" --; git ls-files --others --exclude-standard; } | grep -Ev "^(out/|contexto/|\[.]nivoo/)" | grep -Ei "\[.](tsx|jsx|ts|js|mjs|vue|svelte|astro|html?|css|scss|sass|less|php|jinja2?|twig)$"',
  ].join(' && ');
  return {title:'Remodelagem — '+profile.title,objective,defaultProvider:provider,steps:[{key:'remodelar-frontend',title:'Aplicar identidade visual no frontend existente',instructions,dependsOn:[],verifyCommand,requiresApproval:false}],criteria:[{key:'entrega-remodelagem',description:'Relatório de entrega com evidências e alterações do frontend',kind:'FILE_EXISTS',config:{path:'out/remodelagem.md'}}],limits:{}};
}
