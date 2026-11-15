-- Comandos que a IA pede para rodar em servidores SSH (cada um só roda depois da permissão do usuário).
CREATE TABLE "SshPedido" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "servidorId" TEXT NOT NULL,
    "servidorNome" TEXT NOT NULL,
    "comando" TEXT NOT NULL,
    "motivo" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "jobId" TEXT,
    "mensagemId" TEXT,
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "saida" TEXT,
    "exitCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadoEm" TIMESTAMP(3),
    CONSTRAINT "SshPedido_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SshPedido_projectId_status_idx" ON "SshPedido"("projectId", "status");
ALTER TABLE "SshPedido" ADD CONSTRAINT "SshPedido_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
