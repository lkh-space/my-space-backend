import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import {
  appConfig,
  databaseConfig,
  minioConfig,
  opensearchConfig,
  qdrantConfig,
  rabbitmqConfig,
  aiConfig,
  validateEnv,
} from '@app/config/index.js';
import { AllExceptionsFilter } from '@app/common/filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from '@app/common/interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { StorageModule } from '@app/storage/storage.module.js';

import { AiSearchController } from '../../apps/ai/src/search/ai-search.controller.js';
import { AiSearchService } from '../../apps/ai/src/search/ai-search.service.js';
import { AiChatController } from '../../apps/ai/src/chat/ai-chat.controller.js';
import { AiChatService } from '../../apps/ai/src/chat/ai-chat.service.js';
import { AiToolsService } from '../../apps/ai/src/tools/ai-tools.service.js';
import { IndexingConsumerWorker } from '../../apps/ai/src/indexing/indexing-consumer.worker.js';
import { ProviderFactory } from '../../apps/ai/src/providers/provider.factory.js';

import {
  FakeLlmProvider,
  FakeEmbeddingProvider,
  FakeProviderFactory,
} from './fake-ai-provider.js';
import { TestService } from './test.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.ai', '.env'],
      load: [
        appConfig,
        databaseConfig,
        minioConfig,
        opensearchConfig,
        qdrantConfig,
        rabbitmqConfig,
        aiConfig,
      ],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'silent', // E2E 테스트 시 불필요한 로그 노이즈 방지
      },
    }),
    StorageModule,
  ],
  controllers: [AiSearchController, AiChatController],
  providers: [
    AiSearchService,
    AiChatService,
    AiToolsService,
    IndexingConsumerWorker,
    FakeLlmProvider,
    FakeEmbeddingProvider,
    FakeProviderFactory,
    {
      provide: ProviderFactory,
      useExisting: FakeProviderFactory,
    },
    TestService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
  exports: [
    TestService,
    FakeLlmProvider,
    FakeEmbeddingProvider,
    FakeProviderFactory,
  ],
})
export class AiTestModule {}
