import { Module } from '@nestjs/common';
import { StorageModule } from '@app/storage/storage.module.js';
import { TagResolverService } from './services/tag-resolver.service.js';
import { MarkdownWriterService } from './services/markdown-writer.service.js';

@Module({
  imports: [StorageModule],
  providers: [TagResolverService, MarkdownWriterService],
  exports: [TagResolverService, MarkdownWriterService],
})
export class MarkdownCoreModule {}
