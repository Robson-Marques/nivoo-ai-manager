import type { Anexo } from '../../conversations/attachments';
import type { AreaScope } from '../../specialties/media/scope';
import type { MediaProjectContext } from '../../specialties/media/context';

export interface PlannerProject extends MediaProjectContext {
  area?: AreaScope;
  gitUrl:string|null;
  gitBranch:string|null;
  projetoOrigemId?:string|null;
  visualProfile?:unknown;
}
export type PlannerAttachment = Anexo & { mensagem:string; caminho:string };
export interface PlannerRequest {
  conversationId:string;
  messageId:string;
  messageCreatedAt?:Date;
  project:PlannerProject;
  profileText:string;
  anexos:PlannerAttachment[];
  entrega:string|null;
  providerId:string;
  resultados:string[];
  worktree?:string;
}
