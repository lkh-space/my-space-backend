import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { createAiTestApp } from './create-ai-test-app.js';
import { TestService } from './test.service.js';
import { FakeLlmProvider, FakeEmbeddingProvider } from './fake-ai-provider.js';
import {
  FakeQdrantService,
  FakeMinioService,
  FakeRabbitmqService,
} from './fake-storage.js';

export interface AiE2ETestContext {
  app: INestApplication;
  module: TestingModule;
  req: TestAgent;
  testService: TestService;
  fakeLlm: FakeLlmProvider;
  fakeEmbedding: FakeEmbeddingProvider;
  fakeQdrant: FakeQdrantService;
  fakeMinio: FakeMinioService;
  fakeRabbitmq: FakeRabbitmqService;
}

export const initAiE2ETest = (
  setup?: (context: AiE2ETestContext) => Promise<void>,
): AiE2ETestContext => {
  const context: AiE2ETestContext = {
    app: null as any,
    module: null as any,
    req: null as any,
    testService: null as any,
    fakeLlm: null as any,
    fakeEmbedding: null as any,
    fakeQdrant: null as any,
    fakeMinio: null as any,
    fakeRabbitmq: null as any,
  };

  beforeAll(async () => {
    const result = await createAiTestApp();
    context.app = result.app;
    context.module = result.module;
    context.testService = result.module.get(TestService);
    context.fakeLlm = result.module.get(FakeLlmProvider);
    context.fakeEmbedding = result.module.get(FakeEmbeddingProvider);
    context.fakeQdrant = result.module.get(QdrantService) as unknown as FakeQdrantService;
    context.fakeMinio = result.module.get(MinioService) as unknown as FakeMinioService;
    context.fakeRabbitmq = result.module.get(RabbitmqService) as unknown as FakeRabbitmqService;

    (globalThis as any).testApp = context.app;
    context.req = request(context.app.getHttpServer()) as unknown as TestAgent;

    await context.testService.cleanDatabase();
    context.fakeQdrant.clear();
    context.fakeMinio.clear();
    context.fakeLlm.reset();

    if (setup) {
      await setup(context);
    }
  });

  beforeEach(async () => {
    // 각 테스트 간 가짜 서비스 상태 리셋
    if (context.fakeLlm) {
      context.fakeLlm.reset();
    }
  });

  afterAll(async () => {
    if (context.testService) {
      await context.testService.cleanDatabase();
    }
    if (context.app) {
      await context.app.close();
    }
    delete (globalThis as any).testApp;
  });

  return context;
};
