import { Module, Global } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { MinioModule } from './minio/minio.module.js';
import { OpenSearchModule } from './opensearch/opensearch.module.js';
import { QdrantModule } from './qdrant/qdrant.module.js';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module.js';

@Global()
@Module({
  imports: [
    PrismaModule,
    MinioModule,
    OpenSearchModule,
    QdrantModule,
    RabbitmqModule,
  ],
  exports: [
    PrismaModule,
    MinioModule,
    OpenSearchModule,
    QdrantModule,
    RabbitmqModule,
  ],
})
export class StorageModule {}
