import { Global, Module } from '@nestjs/common';
import { ArtifactStoreService } from './artifact-store.service';
import { WorkspaceService } from './workspace.service';

@Global()
@Module({ providers: [WorkspaceService, ArtifactStoreService], exports: [WorkspaceService, ArtifactStoreService] })
export class StorageModule {}
