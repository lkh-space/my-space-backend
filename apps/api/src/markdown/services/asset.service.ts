import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { validateAssetFile } from '../utils/asset-file.validator.js';
import { AssetUploadResponseDto } from '../dto/asset.dto.js';
import { Readable } from 'node:stream';

@Injectable()
export class AssetService {
  constructor(private readonly minioService: MinioService) {}

  /**
   * 이미지/에셋 파일 업로드
   */
  async uploadAsset(
    ownerId: string,
    file: Express.Multer.File,
  ): Promise<AssetUploadResponseDto> {
    validateAssetFile(file);

    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `images/${ownerId}/${randomUUID()}-${safeFilename}`;

    await this.minioService.putObject(
      this.minioService.assetsBucket,
      objectKey,
      file.buffer,
      file.mimetype,
    );

    const url = `/api/v1/markdown/assets/${objectKey}`;

    return new AssetUploadResponseDto({
      url,
      key: objectKey,
      filename: file.originalname,
      size: file.size,
      contentType: file.mimetype,
    });
  }

  /**
   * 에셋 파일 스트림 조회 (소유자 격리 또는 인증 검증)
   */
  async getAssetStream(
    ownerId: string,
    key: string,
  ): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    // 오브젝트 키가 'images/{ownerId}/...' 형식인지 확인하여 사용자 격리 보장
    if (!key.startsWith(`images/${ownerId}/`)) {
      throw new ForbiddenException('해당 에셋에 대한 접근 권한이 없습니다.');
    }

    return this.minioService.getObjectStream(
      this.minioService.assetsBucket,
      key,
    );
  }
}
