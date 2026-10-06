import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';

export interface DocumentIndexEvent {
  type: 'INDEX';
  documentId: string;
  ownerId: string;
  version: number;
  title: string;
  folderId?: string | null;
  tags?: string[];
  timestamp: string;
}

export interface DocumentDeleteEvent {
  type: 'DELETE';
  documentId: string;
  ownerId: string;
  timestamp: string;
}

export type IndexingMessage = DocumentIndexEvent | DocumentDeleteEvent;

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  public readonly url: string;
  public readonly indexingQueue: string;

  constructor(private readonly configService: ConfigService) {
    this.url = this.configService.get<string>(
      'rabbitmq.url',
      'amqp://localhost:5672',
    );
    this.indexingQueue = this.configService.get<string>(
      'rabbitmq.indexingQueue',
      'markdown-indexing-queue',
    );
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /**
   * RabbitMQ 연결 및 기본 큐 보장
   */
  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();

      await this.channel.assertQueue(this.indexingQueue, {
        durable: true,
      });

      this.logger.log(
        `RabbitMQ 연결 및 큐 초기화 완료 [url=${this.url.replace(/:[^:@]+@/, ':***@')}, queue=${this.indexingQueue}]`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`RabbitMQ 연결 실패 (브로커 상태 확인 필요): ${message}`);
    }
  }

  /**
   * 큐에 메시지 안전하게 발행
   */
  async publish(queue: string, message: unknown): Promise<boolean> {
    if (!this.channel) {
      this.logger.warn(
        `RabbitMQ 채널이 활성화되어 있지 않아 메시지를 발행할 수 없습니다: ${queue}`,
      );
      return false;
    }

    try {
      const buffer = Buffer.from(JSON.stringify(message));
      return this.channel.sendToQueue(queue, buffer, { persistent: true });
    } catch (err: unknown) {
      const messageStr = err instanceof Error ? err.message : String(err);
      this.logger.error(`RabbitMQ 메시지 발행 실패 (${queue}): ${messageStr}`);
      return false;
    }
  }

  /**
   * 큐 구독(Consumer) 등록
   */
  async consume<T = unknown>(
    queue: string,
    handler: (data: T, msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(`RabbitMQ 채널이 없어 Consumer를 등록할 수 없습니다: ${queue}`);
      return;
    }

    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.prefetch(1);

    await this.channel.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        const parsed = JSON.parse(msg.content.toString('utf-8')) as T;
        await handler(parsed, msg);
        this.channel?.ack(msg);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`RabbitMQ 메시지 처리 에러 (${queue}): ${message}`);
        // 에러 시 재처리 방지를 위해 nack(false, false) 또는 nack(false, true)
        this.channel?.nack(msg, false, false);
      }
    });

    this.logger.log(`RabbitMQ Consumer 등록 완료: ${queue}`);
  }

  async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // 무시
    }
  }

  isConnected(): boolean {
    return this.channel !== null;
  }
}
