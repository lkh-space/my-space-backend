import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  HttpCode,
  Res,
  UsePipes,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { JarvisVoiceService } from './jarvis-voice.service.js';
import {
  VoiceStreamQueryDto,
  InterruptQueryDto,
  interruptQuerySchema,
} from './dto/voice-stream.dto.js';
import { AudioFileNotFoundException } from './exceptions/voice.exception.js';
import { BaseDomainException } from '@app/common/exceptions/domain.exception.js';
import { resolveDomainHttpStatus } from '@app/common/filters/domain-error-http.map.js';

@ApiTags('J.A.R.V.I.S. Voice & Neural Core')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 필수, 로컬은 dev-admin)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/ai')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(private readonly voiceService: JarvisVoiceService) {}

  @Post('voice/stream')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'J.A.R.V.I.S. 실시간 음성/텍스트 SSE 스트리밍',
    description:
      'PTT 음성 녹음 Blob 또는 텍스트 질의를 수신하여 STT, LLM 토큰, 벤치마크 지표, 참조 문서 및 TTS 오디오를 SSE로 실시간 스트리밍합니다.',
  })
  @ApiBody({
    description: '음성 스트리밍 요청 데이터 (오디오 파일 또는 텍스트 질의)',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: '신경망 세션 ID (필수)',
          example: 'session-xxxx-xxxx',
        },
        textQuery: {
          type: 'string',
          description: '텍스트 질의 (음성 파일 미전송 시 전달)',
          example: 'OPFS 캐싱 구조와 벤치마크 비교해줘',
        },
        enableTools: {
          type: 'boolean',
          description: 'Qdrant 개인 문서 시맨틱 검색 연동 여부',
          default: true,
        },
        audio: {
          type: 'string',
          format: 'binary',
          description: 'PTT 음성 녹음 오디오 파일 (WAV / WebM, 선택)',
        },
        voiceSettings: {
          type: 'object',
          description: '음성 합성 설정',
          properties: {
            selectedVoice: {
              type: 'string',
              enum: ['JARVIS British AI', 'JARVIS Fast Neural', 'JARVIS Deep Resonant'],
              default: 'JARVIS British AI',
            },
            speechSpeed: {
              type: 'number',
              default: 1.0,
            },
            enableTelemetry: {
              type: 'boolean',
              default: true,
            },
          },
        },
      },
      required: ['sessionId'],
    },
  })
  async streamVoice(
    @CurrentUser() user: AuthUser,
    @Body() rawBody: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // 1. multipart/form-data 및 application/json 입력 정규화
    const sessionId = String(rawBody.sessionId || '');
    const textQuery = rawBody.textQuery ? String(rawBody.textQuery) : undefined;
    const enableTools =
      rawBody.enableTools !== undefined
        ? rawBody.enableTools === true || rawBody.enableTools === 'true'
        : true;

    let voiceSettings: VoiceStreamQueryDto['voiceSettings'] = undefined;
    if (rawBody.voiceSettings) {
      if (typeof rawBody.voiceSettings === 'string') {
        try {
          voiceSettings = JSON.parse(rawBody.voiceSettings);
        } catch {
          // JSON 파싱 실패 시 기본값 유지
        }
      } else if (typeof rawBody.voiceSettings === 'object') {
        voiceSettings = rawBody.voiceSettings as VoiceStreamQueryDto['voiceSettings'];
      }
    }

    const dto: VoiceStreamQueryDto = {
      sessionId,
      textQuery,
      enableTools,
      voiceSettings,
    };

    // 2. SSE 응답 헤더 지연 초기화 (첫 이벤트 방출 시 헤더 전송)
    let headersSent = false;
    const sendHeaders = () => {
      if (!headersSent) {
        res.status(HttpStatus.OK);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        headersSent = true;
      }
    };

    try {
      const audioFileParam = file
        ? {
            buffer: file.buffer,
            mimetype: file.mimetype,
            size: file.size,
          }
        : undefined;

      for await (const chunk of this.voiceService.streamVoiceQuery({
        ownerId: user.username,
        dto,
        audioFile: audioFileParam,
      })) {
        sendHeaders();
        res.write(`event: ${chunk.event}\ndata: ${chunk.data}\n\n`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[VoiceController] 스트리밍 중 예외: ${message}`);

      if (!headersSent) {
        // 아직 SSE 헤더를 전송하지 않은 상태라면 즉시 명확한 HTTP 에러 응답(JSON) 반환
        const statusCode =
          err instanceof BaseDomainException
            ? resolveDomainHttpStatus(err.code)
            : HttpStatus.INTERNAL_SERVER_ERROR;

        res.status(statusCode).json({
          statusCode,
          message,
          error: err instanceof Error ? err.name : 'Internal Server Error',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 이미 SSE 스트림 헤더가 전송된 경우, error와 done 이벤트를 전송하고 즉시 스트림 종료
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
      );
      res.write(
        `event: done\ndata: ${JSON.stringify({ finished: true, error: true })}\n\n`,
      );
    } finally {
      if (headersSent) {
        res.end();
      }
    }
  }

  @Post('chat/interrupt')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(interruptQuerySchema))
  @ApiOperation({
    summary: '발화 즉시 중단 (Speech Interrupt)',
    description:
      '사용자가 스페이스바를 누르면 실행 중인 LLM 생성 및 TTS 합성을 즉시 취소합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '중단 신호 처리 성공',
  })
  async interrupt(
    @CurrentUser() _user: AuthUser,
    @Body() dto: InterruptQueryDto,
  ): Promise<{ status: string; interrupted: boolean }> {
    const { interrupted } = this.voiceService.interrupt(dto.sessionId);
    return { status: 'ok', interrupted };
  }

  @Get('audio/:id')
  @ApiOperation({
    summary: '합성된 오디오 파일 다운로드 및 스트리밍 재생',
    description: '합성 완료된 최종 음성 파일(.wav/.opus)을 서빙합니다.',
  })
  @ApiParam({ name: 'id', description: '오디오 ID (예: speech-xxx.wav)' })
  async getAudio(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const entry = this.voiceService.getAudioBuffer(id);
    if (!entry) {
      throw new AudioFileNotFoundException(id);
    }

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Length', entry.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(entry.buffer);
  }
}
