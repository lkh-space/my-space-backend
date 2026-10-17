/// <reference types="multer" />
import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { formatContentDisposition } from '@app/common/utils/content-disposition.util.js';
import { AssetService } from '../services/asset.service.js';
import { AssetUploadResponseDto } from '../dto/asset.dto.js';

export const MAX_ASSET_FILE_SIZE = 10 * 1024 * 1024; // 10MB (BR-M05)

export const ASSET_UPLOAD_LIMITS = {
  fileSize: MAX_ASSET_FILE_SIZE,
  files: 1,
  fields: 5,
  fieldSize: 1024 * 1024,
};

@ApiTags('Markdown Assets')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/assets')
export class AssetController {
  private readonly logger = new Logger(AssetController.name);

  constructor(private readonly assetService: AssetService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: ASSET_UPLOAD_LIMITS }))
  @ApiOperation({
    summary: '마크다운 첨부 이미지 업로드',
    description: '문서에 포함될 이미지(PNG, JPEG, GIF, WebP, SVG, 최대 10MB)를 업로드하고 MinIO 에셋 버킷에 보관합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '업로드할 이미지 파일',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '이미지 업로드 성공',
    type: AssetUploadResponseDto,
  })
  async uploadAsset(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AssetUploadResponseDto> {
    return this.assetService.uploadAsset(user.username, file);
  }

  @Get('*key')
  @ApiOperation({
    summary: '업로드된 에셋 파일 인라인 스트리밍',
    description: '마크다운 Preview 및 상세 뷰어에서 렌더링할 수 있도록 에셋 파일을 스트리밍 제공합니다.',
  })
  async getAsset(
    @CurrentUser() user: AuthUser,
    @Param('key') keyParam: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    const key = Array.isArray(keyParam) ? keyParam.join('/') : keyParam;
    const { stream, contentType, contentLength } =
      await this.assetService.getAssetStream(user.username, key);

    res.setHeader('Content-Type', contentType ?? 'application/octet-stream');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // 보안 헤더 설정: MIME 스니핑 차단 및 엄격한 CSP(샌드박스) 적용
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );

    // 개인 에셋 보안: 공유 캐시(CDN/프록시)의 타 사용자 캐싱 차단
    res.setHeader('Cache-Control', 'private, max-age=86400');

    // SVG 파일은 스크립트 실행 공격 방지를 위해 attachment로 강제 다운로드 서빙
    if (contentType === 'image/svg+xml') {
      const filename = key.split('/').pop() || 'asset.svg';
      res.setHeader('Content-Disposition', formatContentDisposition(filename, 'attachment'));
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    try {
      await pipeline(stream, res);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      // 클라이언트가 전송 도중 연결을 끊은 경우를 제외하고 에러 로깅
      if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        this.logger.error(
          `에셋 스트리밍 실패 (${key}): ${error?.message ?? '알 수 없는 스트림 에러'}`,
        );
      }
    }
  }
}

