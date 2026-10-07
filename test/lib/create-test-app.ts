import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { AppTestModule } from './app-test.module.js';
import {
  FakeMinioService,
  FakeOpenSearchService,
  FakeRabbitmqService,
} from './fake-storage.js';

export async function createTestApp(): Promise<{
  app: INestApplication;
  module: TestingModule;
}> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppTestModule],
  })
    .overrideProvider(MinioService)
    .useClass(FakeMinioService)
    .overrideProvider(OpenSearchService)
    .useClass(FakeOpenSearchService)
    .overrideProvider(RabbitmqService)
    .useClass(FakeRabbitmqService)
    .compile();

  const app = moduleRef.createNestApplication();

  // pino logger 적용
  const logger = app.get(Logger);
  app.useLogger(logger);

  await app.init();
  return { app, module: moduleRef };
}
