import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp } from './create-test-app.js';

export interface E2ETestContext {
  app: INestApplication;
  module: TestingModule;
  req: TestAgent;
}

export const initE2ETest = (
  setup?: (context: E2ETestContext) => Promise<void>,
): E2ETestContext => {
  const context: E2ETestContext = {
    app: null as any,
    module: null as any,
    req: null as any,
  };

  beforeAll(async () => {
    const result = await createTestApp();
    context.app = result.app;
    context.module = result.module;

    (globalThis as any).testApp = context.app;

    context.req = request(context.app.getHttpServer()) as unknown as TestAgent;

    if (setup) {
      await setup(context);
    }
  });

  afterAll(async () => {
    if (context.app) {
      await context.app.close();
    }
    delete (globalThis as any).testApp;
  });

  return context;
};
