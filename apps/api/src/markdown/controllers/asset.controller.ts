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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
import { AssetService } from '../services/asset.service.js';
import { AssetUploadResponseDto } from '../dto/asset.dto.js';

@ApiTags('Markdown Assets')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
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

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');

    stream.pipe(res);
  }
}
