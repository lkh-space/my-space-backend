import { Module } from '@nestjs/common';
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
import { VersionModule, HealthModule, CoreHttpModule } from '@app/common';
import { StorageModule } from '@app/storage/storage.module.js';
import { MarkdownCoreModule } from '@app/markdown-core';

import { AiSearchController } from '../../apps/ai/src/search/ai-search.controller.js';
import { AiSearchService } from '../../apps/ai/src/search/ai-search.service.js';
import { AiChatController } from '../../apps/ai/src/chat/ai-chat.controller.js';
import { AiChatService } from '../../apps/ai/src/chat/ai-chat.service.js';
import { AiToolsService } from '../../apps/ai/src/tools/ai-tools.service.js';
import { IndexingConsumerWorker } from '../../apps/ai/src/indexing/indexing-consumer.worker.js';
import { ProviderFactory } from '../../apps/ai/src/providers/provider.factory.js';
import { NeuralSessionController } from '../../apps/ai/src/sessions/neural-session.controller.js';
import { NeuralSessionService } from '../../apps/ai/src/sessions/neural-session.service.js';
import { VoiceController } from '../../apps/ai/src/voice/voice.controller.js';
import { JarvisVoiceService } from '../../apps/ai/src/voice/jarvis-voice.service.js';
import { ActiveStreamRegistry } from '../../apps/ai/src/voice/active-stream.registry.js';
import { AudioBufferStore } from '../../apps/ai/src/voice/storage/audio-buffer.store.js';
import {
  MockSttProvider,
  MockTtsProvider,
} from '../../apps/ai/src/providers/voice/mock-voice.provider.js';

import {
  FakeLlmProvider,
  FakeEmbeddingProvider,
  FakeProviderFactory,
} from './fake-ai-provider.js';
import { TestService } from './test.service.js';

@Module({
  imports: [
    CoreHttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.ai'],
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
    MarkdownCoreModule,
    VersionModule.register({ appName: 'ai' }),
    HealthModule,
  ],
  controllers: [
    AiSearchController,
    AiChatController,
    NeuralSessionController,
    VoiceController,
  ],
  providers: [
    AiSearchService,
    AiChatService,
    AiToolsService,
    IndexingConsumerWorker,
    NeuralSessionService,
    ActiveStreamRegistry,
    AudioBufferStore,
    MockSttProvider,
    MockTtsProvider,
    JarvisVoiceService,
    FakeLlmProvider,
    FakeEmbeddingProvider,
    FakeProviderFactory,
    {
      provide: ProviderFactory,
      useExisting: FakeProviderFactory,
    },
    TestService,
  ],
  exports: [
    TestService,
    FakeLlmProvider,
    FakeEmbeddingProvider,
    FakeProviderFactory,
  ],
})
export class AiTestModule {}
