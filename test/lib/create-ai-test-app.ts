import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { AiTestModule } from './ai-test.module.js';
import {
  FakeMinioService,
  FakeOpenSearchService,
  FakeRabbitmqService,
  FakeQdrantService,
} from './fake-storage.js';

export async function createAiTestApp(): Promise<{
  app: INestApplication;
  module: TestingModule;
}> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AiTestModule],
  })
    .overrideProvider(MinioService)
    .useClass(FakeMinioService)
    .overrideProvider(OpenSearchService)
    .useClass(FakeOpenSearchService)
    .overrideProvider(RabbitmqService)
    .useClass(FakeRabbitmqService)
    .overrideProvider(QdrantService)
    .useClass(FakeQdrantService)
    .compile();

  const app = moduleRef.createNestApplication();

  const logger = app.get(Logger);
  app.useLogger(logger);

  await app.init();
  return { app, module: moduleRef };
}
