import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RabbitmqService } from './rabbitmq.service.js';
import { ConfigService } from '@nestjs/config';
import amqp from 'amqplib';

vi.mock('amqplib');

describe('RabbitmqService (신뢰성 있는 브로커 연동, DLQ 및 재시도 단위 테스트)', () => {
  let service: RabbitmqService;
  let configService: ConfigService;
  let mockChannel: any;
  let mockConnection: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      assertExchange: vi.fn().mockResolvedValue({}),
      assertQueue: vi.fn().mockResolvedValue({}),
      bindQueue: vi.fn().mockResolvedValue({}),
      prefetch: vi.fn().mockResolvedValue({}),
      consume: vi.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
      cancel: vi.fn().mockResolvedValue(true),
      sendToQueue: vi.fn().mockReturnValue(true),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    vi.mocked(amqp.connect).mockResolvedValue(mockConnection);

    configService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'rabbitmq.url') return 'amqp://localhost:5672';
        if (key === 'rabbitmq.indexingQueue') return 'markdown-indexing-queue';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new RabbitmqService(configService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('connect 및 토폴로지 선언', () => {
    it('연결 시 DLX, DLQ, Retry Queue 및 메인 큐를 올바른 속성으로 선언해야 한다', async () => {
      // when
      await service.connect();

      // then
      expect(amqp.connect).toHaveBeenCalledWith('amqp://localhost:5672');
      expect(mockConnection.createChannel).toHaveBeenCalled();

      // 1. DLX 선언
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'markdown-indexing-queue.dlx',
        'direct',
        { durable: true },
      );

      // 2. DLQ 선언 및 바인딩
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue.dlq',
        { durable: true },
      );
      expect(mockChannel.bindQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue.dlq',
        'markdown-indexing-queue.dlx',
        'dead',
      );

      // 3. 지연 재시도 큐 선언 (5초 TTL)
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue.retry',
        {
          durable: true,
          arguments: {
            'x-message-ttl': 5000,
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': 'markdown-indexing-queue',
          },
        },
      );

      // 4. 메인 큐 선언 (실패 시 DLX 라우팅)
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue',
        {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': 'markdown-indexing-queue.dlx',
            'x-dead-letter-routing-key': 'dead',
          },
        },
      );

      expect(service.isConnected()).toBe(true);
    });
  });

  describe('publish', () => {
    it('채널이 없을 때는 false를 반환해야 한다', async () => {
      // given: connect 하지 않은 상태
      // when
      const result = await service.publish('some-queue', { foo: 'bar' });

      // then
      expect(result).toBe(false);
      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    });

    it('채널이 활성화되어 있을 때는 persistent 플래그와 x-attempt 헤더를 붙여 메시지를 발행해야 한다', async () => {
      // given
      await service.connect();
      const message = { type: 'INDEX', documentId: 'doc-1' };

      // when
      const result = await service.publish('markdown-indexing-queue', message);

      // then
      expect(result).toBe(true);
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue',
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          headers: {
            'x-attempt': 1,
          },
        },
      );
    });
  });

  describe('consume 및 재시도/DLQ 분기', () => {
    it('메시지 처리가 성공하면 channel.ack를 호출해야 한다', async () => {
      // given
      await service.connect();
      let messageConsumerCallback: (msg: any) => Promise<void> = () => Promise.resolve();

      mockChannel.consume.mockImplementation(
        async (_queue: string, callback: (msg: any) => Promise<void>) => {
          messageConsumerCallback = callback;
        },
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      await service.consume('markdown-indexing-queue', handler);

      const mockMsg = {
        content: Buffer.from(JSON.stringify({ hello: 'world' })),
        properties: { headers: { 'x-attempt': 1 } },
      };

      // when
      await messageConsumerCallback(mockMsg);

      // then
      expect(handler).toHaveBeenCalledWith({ hello: 'world' }, mockMsg);
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('메시지 처리 실패 시 3회 미만이면 재시도 큐로 발행하고 원본 메시지를 ack해야 한다', async () => {
      // given
      await service.connect();
      let messageConsumerCallback: (msg: any) => Promise<void> = () => Promise.resolve();

      mockChannel.consume.mockImplementation(
        async (_queue: string, callback: (msg: any) => Promise<void>) => {
          messageConsumerCallback = callback;
        },
      );

      const handler = vi.fn().mockRejectedValue(new Error('일시적 처리 오류'));
      await service.consume('markdown-indexing-queue', handler);

      const mockMsg = {
        content: Buffer.from(JSON.stringify({ docId: 'doc-123' })),
        properties: { headers: { 'x-attempt': 1 } },
      };

      // when
      await messageConsumerCallback(mockMsg);

      // then
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'markdown-indexing-queue.retry',
        mockMsg.content,
        expect.objectContaining({
          persistent: true,
          headers: expect.objectContaining({ 'x-attempt': 2 }),
        }),
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('메시지 처리 실패 시 3회 이상(최대 재시도 초과)이면 nack(false, false)로 DLQ로 보내야 한다', async () => {
      // given
      await service.connect();
      let messageConsumerCallback: (msg: any) => Promise<void> = () => Promise.resolve();

      mockChannel.consume.mockImplementation(
        async (_queue: string, callback: (msg: any) => Promise<void>) => {
          messageConsumerCallback = callback;
        },
      );

      const handler = vi.fn().mockRejectedValue(new Error('반복된 처리 오류'));
      await service.consume('markdown-indexing-queue', handler);

      const mockMsg = {
        content: Buffer.from(JSON.stringify({ docId: 'doc-fail' })),
        properties: { headers: { 'x-attempt': 3 } },
      };

      // when
      await messageConsumerCallback(mockMsg);

      // then
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });

    it('손상된 JSON 수신 시 재시도 없이 즉시 nack(false, false)로 DLQ로 보내야 한다', async () => {
      // given
      await service.connect();
      let messageConsumerCallback: (msg: any) => Promise<void> = () => Promise.resolve();

      mockChannel.consume.mockImplementation(
        async (_queue: string, callback: (msg: any) => Promise<void>) => {
          messageConsumerCallback = callback;
        },
      );

      const handler = vi.fn();
      await service.consume('markdown-indexing-queue', handler);

      const corruptedMsg = {
        content: Buffer.from('this is not json'),
        properties: { headers: {} },
      };

      // when
      await messageConsumerCallback(corruptedMsg);

      // then
      expect(handler).not.toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(corruptedMsg, false, false);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });

  describe('연결 끊김 및 재연결', () => {
    it('연결 close 이벤트 발생 시 리소스를 정리하고 재연결을 준비해야 한다', async () => {
      // given
      await service.connect();
      expect(service.isConnected()).toBe(true);

      const closeHandler = mockConnection.on.mock.calls.find(
        (call: any[]) => call[0] === 'close',
      )?.[1];
      expect(closeHandler).toBeDefined();

      // when: 브로커 연결 종료 이벤트 트리거
      closeHandler(new Error('Connection reset by peer'));

      // then
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('분산 추적 (Distributed Tracing) 헤더 전파 및 복원', () => {
    it('TraceContext에 활성화된 requestId가 있으면 publish 시 x-request-id와 traceparent를 헤더에 자동 주입한다', async () => {
      // given
      const { TraceContextService } = await import('@app/common');
      const traceContextService = new TraceContextService();
      const tracingRabbitmqService = new RabbitmqService(configService, traceContextService);
      await tracingRabbitmqService.connect();

      // when: 활성화된 HTTP 요청 컨텍스트 내에서 이벤트 발행
      await traceContextService.runWithContext(
        { requestId: 'http-req-999', traceId: 'trace-parent-999' },
        async () => {
          await tracingRabbitmqService.publish('test-queue', { message: 'hello' });
        },
      );

      // then
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          headers: expect.objectContaining({
            'x-attempt': 1,
            'x-request-id': 'http-req-999',
            'x-trace-id': 'trace-parent-999',
            traceparent: 'trace-parent-999',
          }),
        }),
      );
    });

    it('consume 시 메시지 헤더의 x-request-id를 복원하여 핸들러 내부에서 동일한 requestId를 조회할 수 있어야 한다', async () => {
      // given
      const { TraceContextService } = await import('@app/common');
      const traceContextService = new TraceContextService();
      const tracingRabbitmqService = new RabbitmqService(configService, traceContextService);
      await tracingRabbitmqService.connect();

      let messageConsumerCallback: (msg: any) => Promise<void> = () => Promise.resolve();
      mockChannel.consume.mockImplementation(
        async (_queue: string, callback: (msg: any) => Promise<void>) => {
          messageConsumerCallback = callback;
          return { consumerTag: 'tag-trace' };
        },
      );

      let capturedRequestId: string | undefined;
      const handler = vi.fn().mockImplementation(async () => {
        capturedRequestId = traceContextService.getRequestId();
      });

      await tracingRabbitmqService.consume('markdown-indexing-queue', handler);

      const mockMsg = {
        content: Buffer.from(JSON.stringify({ docId: 'doc-trace-123' })),
        properties: {
          headers: {
            'x-attempt': 1,
            'x-request-id': 'incoming-http-trace-id',
          },
        },
      };

      // when: 메시지 소비 콜백 호출
      await messageConsumerCallback(mockMsg);

      // then
      expect(handler).toHaveBeenCalled();
      expect(capturedRequestId).toBe('incoming-http-trace-id');
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('우아한 종료 (Graceful Shutdown) 및 Drain 메커니즘', () => {
    it('consume 등록 시 consumerTag가 보관되고 disconnect 시 channel.cancel(consumerTag)이 호출되어 신규 인입을 차단해야 한다', async () => {
      // given
      await service.connect();
      await service.consume('markdown-indexing-queue', vi.fn());

      expect(service.getActiveConsumerTags().get('markdown-indexing-queue')).toBe('tag-1');

      // when
      await service.disconnect();

      // then
      expect(mockChannel.cancel).toHaveBeenCalledWith('tag-1');
      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('진행 중인 in-flight 메시지가 완료될 때까지 대기 후 안전하게 연결을 해제해야 한다', async () => {
      // given
      await service.connect();

      let messageCallback: (msg: any) => Promise<void> = () => Promise.resolve();
      mockChannel.consume.mockImplementation(async (_queue: string, cb: any) => {
        messageCallback = cb;
        return { consumerTag: 'tag-drain' };
      });

      let finishTask: () => void = () => {};
      const longRunningTask = new Promise<void>((resolve) => {
        finishTask = resolve;
      });

      const handler = vi.fn().mockImplementation(async () => {
        await longRunningTask;
      });

      await service.consume('markdown-indexing-queue', handler);

      const mockMsg = {
        content: Buffer.from(JSON.stringify({ docId: 'doc-drain-1' })),
        properties: { headers: {} },
      };

      // when: 메시지 처리 시작 (비동기)
      const messagePromise = messageCallback(mockMsg);
      expect(service.getActiveMessageCount()).toBe(1);

      // disconnect 실행 (drain 대기 중)
      let disconnectFinished = false;
      const disconnectPromise = service.disconnect().then(() => {
        disconnectFinished = true;
      });

      // 아직 task가 끝나지 않았으므로 disconnect도 완료되지 않아야 함
      await new Promise((r) => setTimeout(r, 60));
      expect(disconnectFinished).toBe(false);
      expect(service.getActiveMessageCount()).toBe(1);

      // task 완료
      finishTask();
      await messagePromise;
      await disconnectPromise;

      // then
      expect(disconnectFinished).toBe(true);
      expect(service.getActiveMessageCount()).toBe(0);
      expect(mockChannel.cancel).toHaveBeenCalledWith('tag-drain');
      expect(mockChannel.close).toHaveBeenCalled();
    });

    it('checkHealth 호출 시 채널이 연결되어 있으면 정상 통과하고 없으면 예외를 던져야 한다', async () => {
      // given
      await service.connect();

      // then: 연결 상태
      await expect(service.checkHealth()).resolves.toBeUndefined();

      // when: 연결 해제
      await service.disconnect();

      // then: 해제 상태
      await expect(service.checkHealth()).rejects.toThrow('RabbitMQ 채널이 활성화되어 있지 않습니다');
    });
  });
});

