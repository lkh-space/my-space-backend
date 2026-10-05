import { Module, Global } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { MinioModule } from './minio/minio.module.js';
import { OpenSearchModule } from './opensearch/opensearch.module.js';

@Global()
@Module({
  imports: [PrismaModule, MinioModule, OpenSearchModule],
  exports: [PrismaModule, MinioModule, OpenSearchModule],
})
export class StorageModule {}
