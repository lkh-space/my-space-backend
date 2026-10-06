import { registerAs } from '@nestjs/config';

/**
 * RabbitMQ 메시지 브로커 네임스페이스 설정 ('rabbitmq')
 */
export const rabbitmqConfig = registerAs('rabbitmq', () => ({
  url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  indexingQueue: process.env.RABBITMQ_INDEXING_QUEUE || 'markdown-indexing-queue',
}));
