import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { createLoggerConfig } from '@app/common/logger/logger.config.js';
import { HealthModule } from '@app/common';
import { StorageModule } from '@app/storage/storage.module.js';

import { GeminiProvider } from './providers/gemini.provider.js';
import { OllamaProvider } from './providers/ollama.provider.js';
import { ProviderFactory } from './providers/provider.factory.js';
import { IndexingConsumerWorker } from './indexing/indexing-consumer.worker.js';
import { AiToolsService } from './tools/ai-tools.service.js';
import { AiSearchService } from './search/ai-search.service.js';
import { AiSearchController } from './search/ai-search.controller.js';
import { AiChatService } from './chat/ai-chat.service.js';
import { AiChatController } from './chat/ai-chat.controller.js';

import { NeuralSessionController } from './sessions/neural-session.controller.js';
import { NeuralSessionService } from './sessions/neural-session.service.js';
import { VoiceController } from './voice/voice.controller.js';
import { JarvisVoiceService } from './voice/jarvis-voice.service.js';
import { ActiveStreamRegistry } from './voice/active-stream.registry.js';
import { AudioBufferStore } from './voice/storage/audio-buffer.store.js';
import { MockSttProvider, MockTtsProvider } from './providers/voice/mock-voice.provider.js';

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
    StorageModule,
    HealthModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isLocal = configService.get<boolean>('app.isLocal', false);
        const logLevel = configService.get<string>(
          'app.logLevel',
          isLocal ? 'debug' : 'info',
        );
        return createLoggerConfig({ isLocal, logLevel });
      },
    }),
  ],
  controllers: [
    AiSearchController,
    AiChatController,
    NeuralSessionController,
    VoiceController,
  ],
  providers: [
    GeminiProvider,
    OllamaProvider,
    ProviderFactory,
    IndexingConsumerWorker,
    AiToolsService,
    AiSearchService,
    AiChatService,
    NeuralSessionService,
    ActiveStreamRegistry,
    AudioBufferStore,
    MockSttProvider,
    MockTtsProvider,
    JarvisVoiceService,
  ],
})
export class AiAppModule {}
