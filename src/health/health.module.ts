import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
