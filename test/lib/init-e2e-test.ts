import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp } from './create-test-app.js';
import { TestService } from './test.service.js';

export interface E2ETestContext {
  app: INestApplication;
  module: TestingModule;
  req: TestAgent;
  testService: TestService;
}

export const initE2ETest = (
  setup?: (context: E2ETestContext) => Promise<void>,
): E2ETestContext => {
  const context: E2ETestContext = {
    app: null as any,
    module: null as any,
    req: null as any,
    testService: null as any,
  };

  beforeAll(async () => {
    const result = await createTestApp();
    context.app = result.app;
    context.module = result.module;
    context.testService = result.module.get(TestService);

    (globalThis as any).testApp = context.app;
    context.req = request(context.app.getHttpServer()) as unknown as TestAgent;

    // 이전 잔여 데이터 청소
    await context.testService.cleanDatabase();

    if (setup) {
      await setup(context);
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
