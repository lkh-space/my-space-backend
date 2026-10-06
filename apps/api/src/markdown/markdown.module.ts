import { Module } from '@nestjs/common';
import { FolderController } from './controllers/folder.controller.js';
import { FolderService } from './services/folder.service.js';
import { TagController } from './controllers/tag.controller.js';
import { TagService } from './services/tag.service.js';
import { DocumentController } from './controllers/document.controller.js';
import { DocumentService } from './services/document.service.js';
import { RevisionController } from './controllers/revision.controller.js';
import { RevisionService } from './services/revision.service.js';

import { SearchController } from './controllers/search.controller.js';
import { SearchService } from './services/search.service.js';
import { AssetController } from './controllers/asset.controller.js';
import { AssetService } from './services/asset.service.js';

@Module({
  controllers: [
    FolderController,
    TagController,
    DocumentController,
    RevisionController,
    SearchController,
    AssetController,
  ],
  providers: [
    FolderService,
    TagService,
    DocumentService,
    RevisionService,
    SearchService,
    AssetService,
  ],
  exports: [
    FolderService,
    TagService,
    DocumentService,
    RevisionService,
    SearchService,
    AssetService,
  ],
})
export class MarkdownModule {}
