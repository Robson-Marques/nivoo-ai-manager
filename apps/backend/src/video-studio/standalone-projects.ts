import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// Projetos de produção audiovisual independentes dos projetos de conversação.
// Os arquivos grandes ficam no volume de workspaces e nunca no código Git.
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type VideoProduction={id:string;title:string;createdAt:string;updatedAt:string};
export const productionsRoot=()=>path.join(process.env.NIVOO_WORKSPACES_ROOT||'/var/lib/nivoo/data/workspaces','.nivoo-studio');
export function productionDir(id:string):string {
  if(!ID.test(id))throw new BadRequestException('Identificador de produção inválido');
  return path.join(productionsRoot(),id);
}
export function getProduction(id:string):VideoProduction {
  const meta=path.join(productionDir(id),'project.json');
  if(!fs.existsSync(meta))throw new NotFoundException('Produção audiovisual não encontrada');
  const p=JSON.parse(fs.readFileSync(meta,'utf8')) as VideoProduction;
  if(p.id!==id)throw new NotFoundException('Produção audiovisual inválida');
  return p;
}
export function maybeProductionMedia(id:string):string|null {
  if(!ID.test(id))return null;
  const meta=path.join(productionsRoot(),id,'project.json');
  if(!fs.existsSync(meta))return null;
  getProduction(id);
  return path.join(productionDir(id),'midia');
}
export function listProductions():VideoProduction[] {
  const root=productionsRoot();
  if(!fs.existsSync(root))return [];
  return fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&ID.test(e.name))
    .flatMap(e=>{try{return [getProduction(e.name)]}catch{return []}})
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function createProduction(raw:string):VideoProduction {
  const title=String(raw||'').trim();
  if(!title||title.length>120)throw new BadRequestException('Nome do projeto: 1 a 120 caracteres');
  const now=new Date().toISOString();
  const p={id:randomUUID(),title,createdAt:now,updatedAt:now};
  const dir=productionDir(p.id);
  fs.mkdirSync(path.join(dir,'midia','entrada'),{recursive:true});
  fs.mkdirSync(path.join(dir,'midia','saida'),{recursive:true});
  fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(p,null,2),{flag:'wx'});
  return p;
}
