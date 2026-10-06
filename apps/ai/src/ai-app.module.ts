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
  controllers: [AiSearchController, AiChatController],
  providers: [
    GeminiProvider,
    OllamaProvider,
    ProviderFactory,
    IndexingConsumerWorker,
    AiToolsService,
    AiSearchService,
    AiChatService,
  ],
})
export class AiAppModule {}
