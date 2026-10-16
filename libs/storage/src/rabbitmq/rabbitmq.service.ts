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

export interface RegisteredConsumer {
  handler: (data: any, msg: ConsumeMessage) => Promise<void>;
}

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  public readonly url: string;
  public readonly indexingQueue: string;
  public readonly deadLetterExchange: string;
  public readonly deadLetterQueue: string;
  public readonly retryQueue: string;

  private isClosing = false;
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  // 재연결 시 자동 재등록할 Consumer 목록
  private readonly registeredConsumers = new Map<string, RegisteredConsumer>();

  constructor(private readonly configService: ConfigService) {
    this.url = this.configService.get<string>(
      'rabbitmq.url',
      'amqp://localhost:5672',
    );
    this.indexingQueue = this.configService.get<string>(
      'rabbitmq.indexingQueue',
      'markdown-indexing-queue',
    );
    this.deadLetterExchange = `${this.indexingQueue}.dlx`;
    this.deadLetterQueue = `${this.indexingQueue}.dlq`;
    this.retryQueue = `${this.indexingQueue}.retry`;
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.disconnect();
  }

  /**
   * RabbitMQ 연결, 토폴로지(DLX, DLQ, Retry, Main) 보장 및 이벤트 리스너 바인딩
   */
  async connect(): Promise<void> {
    if (this.isClosing || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    try {
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();
      this.reconnectAttempts = 0;

      // 연결 및 채널 에러/종료 이벤트 리스너 등록
      this.connection.on('close', (err) => {
        this.logger.warn(`RabbitMQ 연결 종료 감지: ${err ? (err as Error).message : '정상 닫힘'}`);
        this.handleConnectionLost();
      });

      this.connection.on('error', (err) => {
        this.logger.error(`RabbitMQ 연결 에러 발생: ${(err as Error).message}`);
        this.handleConnectionLost();
      });

      this.channel.on('close', () => {
        this.logger.warn('RabbitMQ 채널 닫힘 감지');
      });

      this.channel.on('error', (err) => {
        this.logger.error(`RabbitMQ 채널 에러 발생: ${(err as Error).message}`);
      });

      // DLQ, Retry, Main 큐 토폴로지 구성
      await this.setupTopology(this.channel);

      this.logger.log(
        `RabbitMQ 연결 및 토폴로지 초기화 완료 [url=${this.url.replace(/:[^:@]+@/, ':***@')}, queue=${this.indexingQueue}, dlq=${this.deadLetterQueue}]`,
      );

      // 기존 등록된 모든 Consumer 재등록
      for (const [queue, consumer] of this.registeredConsumers.entries()) {
        await this.bindConsumer(queue, consumer.handler);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`RabbitMQ 연결 실패 (브로커 상태 확인 필요): ${message}`);
      this.handleConnectionLost();
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * DLX, DLQ, Retry Queue, Main Queue 토폴로지 선언
   */
  private async setupTopology(channel: Channel): Promise<void> {
    // 1. Dead Letter Exchange (DLX) 선언
    await channel.assertExchange(this.deadLetterExchange, 'direct', { durable: true });

    // 2. Dead Letter Queue (DLQ) 선언 및 바인딩
    await channel.assertQueue(this.deadLetterQueue, { durable: true });
    await channel.bindQueue(this.deadLetterQueue, this.deadLetterExchange, 'dead');

    // 3. 지연 재시도 큐 (Retry Queue, 5초 TTL 후 메인 큐 재투입)
    await channel.assertQueue(this.retryQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': 5000,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': this.indexingQueue,
      },
    });

    // 4. 메인 큐 선언 (실패 시 DLX 라우팅)
    try {
      await channel.assertQueue(this.indexingQueue, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.deadLetterExchange,
          'x-dead-letter-routing-key': 'dead',
        },
      });
    } catch (err: unknown) {
      // 기존 브로커에 다른 인자로 선언된 큐가 있는 경우의 호환성 fallback
      this.logger.warn(
        `메인 큐 인자 선언 실패 (기존 큐와의 속성 불일치 가능성): ${(err as Error)?.message}`,
      );
      await channel.assertQueue(this.indexingQueue, { durable: true });
    }
  }

  /**
   * 연결 유실 처리 및 지수 백오프 기반 재연결 스케줄링
   */
  private handleConnectionLost(): void {
    this.channel = null;
    this.connection = null;

    if (this.isClosing || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = backoff + jitter;

    this.logger.warn(
      `RabbitMQ 재연결 대기: ${delay}ms 후 재시도합니다... (시도 #${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, delay);
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
      const sent = this.channel.sendToQueue(queue, buffer, {
        persistent: true,
        headers: {
          'x-attempt': 1,
        },
      });

      if (!sent) {
        this.logger.warn(`RabbitMQ 버퍼 포화로 발행 지연 발생 (queue=${queue})`);
      }
      return sent;
    } catch (err: unknown) {
      const messageStr = err instanceof Error ? err.message : String(err);
      this.logger.error(`RabbitMQ 메시지 발행 실패 (${queue}): ${messageStr}`);
      return false;
    }
  }

  /**
   * 큐 구독(Consumer) 등록 및 재연결 대비 보관
   */
  async consume<T = unknown>(
    queue: string,
    handler: (data: T, msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    this.registeredConsumers.set(queue, { handler });

    if (this.channel) {
      await this.bindConsumer(queue, handler);
    } else {
      this.logger.log(`RabbitMQ 채널 대기 중: 연결 완료 시 Consumer가 자동 등록됩니다 (${queue})`);
    }
  }

  /**
   * 채널에 Consumer 바인딩 및 재시도/DLQ 분기 처리
   */
  private async bindConsumer<T>(
    queue: string,
    handler: (data: T, msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) return;

    await this.channel.prefetch(1);

    await this.channel.consume(queue, async (msg) => {
      if (!msg) return;

      const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 1);
      let parsed: T;
      try {
        parsed = JSON.parse(msg.content.toString('utf-8')) as T;
      } catch (parseErr) {
        this.logger.error(
          `메시지 JSON 파싱 치명적 에러 (즉시 DLQ 전송): ${(parseErr as Error)?.message}`,
        );
        // 복구 불가능한 손상 메시지는 재시도 없이 즉시 DLQ(nack)로 전송
        this.channel?.nack(msg, false, false);
        return;
      }

      try {
        await handler(parsed, msg);
        this.channel?.ack(msg);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `RabbitMQ 메시지 처리 실패 (시도 ${attempt}/3, queue=${queue}): ${errorMsg}`,
        );

        if (attempt < 3) {
          // 일시적 오류 시 5초 지연 재시도 큐로 발행 후 원본 메시지 ack
          const headers = { ...msg.properties.headers, 'x-attempt': attempt + 1 };
          this.channel?.sendToQueue(this.retryQueue, msg.content, {
            persistent: true,
            headers,
          });
          this.channel?.ack(msg);
        } else {
          // 최대 재시도(3회) 초과 시 Dead Letter Queue로 라우팅
          this.logger.warn(
            `메시지가 최대 재시도 횟수(3회)를 초과하여 DLQ(${this.deadLetterQueue})로 이동합니다.`,
          );
          this.channel?.nack(msg, false, false);
        }
      }
    });

    this.logger.log(`RabbitMQ Consumer 등록 및 바인딩 완료: ${queue}`);
  }

  async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // 무시
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }

  isConnected(): boolean {
    return this.channel !== null;
  }
}
