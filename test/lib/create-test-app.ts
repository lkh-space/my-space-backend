import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { AppTestModule } from './app-test.module.js';

export async function createTestApp(): Promise<{
  app: INestApplication;
  module: TestingModule;
}> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppTestModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  // pino logger 적용
  const logger = app.get(Logger);
  app.useLogger(logger);

  await app.init();
  return { app, module: moduleRef };
}
