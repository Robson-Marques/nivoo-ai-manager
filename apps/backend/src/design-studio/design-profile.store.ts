import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';
import { findDesignSource } from './catalog';
import { defaultVisual, validateVisual, VisualSettings } from './visual';

export type DesignMode = 'new' | 'remodel';
export type DesignProfile = {
  schemaVersion: 1; id: string; title: string; mode: DesignMode;
  projectId: string | null; sourceId: string; theme: 'light' | 'dark' | 'system';
  createdAt: string; updatedAt: string; revision: number; visual:VisualSettings;
};
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validated(raw: unknown): Pick<DesignProfile,'title'|'mode'|'sourceId'|'theme'|'projectId'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Configuração inválida');
  const b=raw as Record<string,unknown>;
  const title=typeof b.title==='string'?b.title.trim():'';
  if (!title || title.length>120) throw new BadRequestException('Nome: 1 a 120 caracteres');
  if (b.mode!=='new' && b.mode!=='remodel') throw new BadRequestException('Modo inválido');
  if (typeof b.sourceId!=='string' || !findDesignSource(b.sourceId) || findDesignSource(b.sourceId)?.kind==='reference') throw new BadRequestException('Selecione um motor do catálogo, não uma referência visual');
  if (b.theme!=='light' && b.theme!=='dark' && b.theme!=='system') throw new BadRequestException('Tema inválido');
  const projectId=b.projectId??null;
  if(projectId!==null&&(typeof projectId!=='string'||!ID.test(projectId)))throw new BadRequestException('Projeto inválido');
  return {title,mode:b.mode,sourceId:b.sourceId,theme:b.theme,projectId};
}

/** Isolated, persistent workspace records; never writes to a target Git repository. */
export class DesignProfileStore {
  constructor(private readonly root = path.join(appConfig().workspacesRoot,'.nivoo-design-studio')) {}
  private filename(id: string) {
    if (!ID.test(id)) throw new BadRequestException('Identificador inválido');
    return path.join(this.root,id+'.json');
  }
  get(id: string): DesignProfile {
    const file=this.filename(id);
    if(!fs.existsSync(file)) throw new NotFoundException('Perfil de design não encontrado');
    const p=JSON.parse(fs.readFileSync(file,'utf8')) as DesignProfile;
    if(p.id!==id || p.schemaVersion!==1) throw new ConflictException('Perfil inválido ou versão não suportada');
    return {...p,projectId:p.projectId??null,visual:p.visual?validateVisual(p.visual):defaultVisual};
  }
  list(): DesignProfile[] {
    if(!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root,{withFileTypes:true})
      .filter(e=>e.isFile() && e.name.endsWith('.json') && ID.test(e.name.slice(0,-5)))
      .map(e=>this.get(e.name.slice(0,-5)))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  private write(p: DesignProfile) {
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    const target=this.filename(p.id);
    const tmp=target+'.'+randomUUID()+'.tmp';
    try {
      fs.writeFileSync(tmp,JSON.stringify(p,null,2),{flag:'wx',mode:0o600});
      fs.renameSync(tmp,target);
    } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return p;
  }
  create(raw: unknown) {
    const fields=validated(raw); const now=new Date().toISOString();
    const v=(raw as Record<string,unknown>).visual;
    return this.write({schemaVersion:1,id:randomUUID(),...fields,visual:v===undefined?defaultVisual:validateVisual(v),createdAt:now,updatedAt:now,revision:1});
  }
  update(id: string, raw: unknown) {
    const p=this.get(id);
    const fields=validated(raw&&typeof raw==='object'&&!Array.isArray(raw)?{projectId:p.projectId,...raw}:raw);
    const revision=(raw as Record<string,unknown>).revision;
    if(revision!==p.revision) throw new ConflictException('O perfil foi alterado. Recarregue antes de salvar.');
    const v=(raw as Record<string,unknown>).visual;
    return this.write({...p,...fields,visual:v===undefined?p.visual:validateVisual(v),updatedAt:new Date().toISOString(),revision:p.revision+1});
  }
}
