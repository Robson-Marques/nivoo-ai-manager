import { BadRequestException, NotFoundException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { designCatalog } from './catalog';
import { defaultVisual, palettes, validateVisual } from './visual';
import { DesignProfileStore } from './design-profile.store';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { inspectFrontend } from './frontend-analysis';
import { ConversationsService } from '../conversations/conversations.service';
import { findDesignSource } from './catalog';
import { makeRemodelPlan,validateScope,vendorFiles } from './remodel-plan';
import * as fs from 'node:fs';
import * as path from 'node:path';

@Controller('design-studio')
export class DesignStudioController {
  private readonly store = new DesignProfileStore();
  constructor(private readonly prisma:PrismaService,private readonly workspace:WorkspaceService,private readonly conversations:ConversationsService){}
  private async assertTarget(raw:unknown){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
    const id=(raw as Record<string,unknown>).projectId;
    if(id===undefined||id===null)return;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new BadRequestException('Projeto inválido');
    const p=await this.prisma.project.findUnique({where:{id},select:{id:true,archivedAt:true}});
    if(!p||p.archivedAt)throw new BadRequestException('Selecione um projeto ativo do Nivoo');
  }
  @Get('projects/:id/analysis') async analyze(@Param('id',ParseUUIDPipe) id:string){
    const p=await this.prisma.project.findUnique({where:{id},select:{id:true,name:true,dirKey:true,gitUrl:true,gitBranch:true,archivedAt:true}});
    if(!p||p.archivedAt)throw new NotFoundException('Projeto ativo não encontrado');
    return {project:{id:p.id,name:p.name,url:p.gitUrl,branch:p.gitBranch},...(await inspectFrontend(this.workspace.projectDirs(p.dirKey).repo))};
  }
  @Post(['profiles/:id/remodel-plan','profiles/:id/design-plan']) async remodel(@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){
    if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Pedido inválido');
    const b=body as Record<string,unknown>;
    const profile=this.store.get(id);
    if(!profile.projectId)throw new BadRequestException('Salve o perfil com o projeto de destino');
    if(b.revision!==profile.revision)throw new BadRequestException('O perfil mudou; salve e revise novamente');
    const source=findDesignSource(profile.sourceId);
    if(!source?.adapter||source.status!=='ready')throw new BadRequestException('Este motor ainda não está disponível para remodelagem');
    const project=await this.prisma.project.findUnique({where:{id:profile.projectId},select:{id:true,name:true,dirKey:true,provider:true,archivedAt:true}});
    if(!project||project.archivedAt)throw new NotFoundException('Projeto ativo não encontrado');
    const analysis=await inspectFrontend(this.workspace.projectDirs(project.dirKey).repo);
    if(b.commit!==analysis.commit)throw new BadRequestException('O código local mudou. Analise novamente antes de preparar o trabalho.');
    const scope=validateScope(b.scope,[...new Set([...analysis.frontend.examples,...analysis.pages.examples,...analysis.components.examples,...analysis.styles.examples])]);
    const vendorRoot=path.resolve(__dirname,'../../../web/public/design-preview/vendor');
    const assets=vendorFiles[source.adapter].map(nome=>{
      const file=path.join(vendorRoot,nome);
      if(!fs.existsSync(file))throw new BadRequestException('Arquivo do motor não instalado: '+nome);
      return {nome,contentBase64:fs.readFileSync(file).toString('base64')};
    });
    const plan=makeRemodelPlan(profile,analysis.commit,scope,project.provider,assets);
    const request=plan.objective;
    const result=await this.conversations.createPreparedPlan(project.id,plan.title,request,plan,assets);
    return {projectId:project.id,...result};
  }
  @Post('tokens/validate') validateTokens(@Body() body:unknown){
    if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Arquivo de tokens inválido');
    const b=body as Record<string,unknown>;
    if(b.schemaVersion!==1)throw new BadRequestException('Versão de tokens não suportada');
    return {schemaVersion:1,visual:validateVisual(b.visual)};
  }
  @Get('catalog') catalog() { return {schemaVersion:1,sources:designCatalog,palettes,defaultVisual}; }
  @Get('profiles') list() { return this.store.list(); }
  @Get('profiles/:id') get(@Param('id',ParseUUIDPipe) id:string) { return this.store.get(id); }
  @Post('profiles') async create(@Body() body:unknown) { await this.assertTarget(body);return this.store.create(body); }
  @Put('profiles/:id') async update(@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown) { await this.assertTarget(body);return this.store.update(id,body); }
}
