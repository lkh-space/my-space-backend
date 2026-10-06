import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitmqService } from './rabbitmq.service.js';

@Module({
  imports: [ConfigModule],
  providers: [RabbitmqService],
  exports: [RabbitmqService],
})
export class RabbitmqModule {}
