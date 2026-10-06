import {
  Injectable,
  OnModuleInit,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client!: S3Client;
  private bucketDocs!: string;
  private bucketAssets!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const endpoint = this.configService.get<string>(
      'minio.endpoint',
      'http://localhost:9000',
    );
    const region = this.configService.get<string>('minio.region', 'us-east-1');
    const accessKey = this.configService.get<string>('minio.accessKey', '');
    const secretKey = this.configService.get<string>('minio.secretKey', '');
    const forcePathStyle = this.configService.get<boolean>(
      'minio.forcePathStyle',
      true,
    );

    this.bucketDocs = this.configService.get<string>(
      'minio.bucketDocs',
      'my-space-markdown',
    );
    this.bucketAssets = this.configService.get<string>(
      'minio.bucketAssets',
      'my-space-assets',
    );

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle,
    });

    this.logger.log(`MinIO S3Client 초기화 완료 (Endpoint: ${endpoint})`);
    this.ensureBuckets().catch((err) => {
      this.logger.warn(`MinIO 버킷 확인/생성 중 알림: ${(err as Error).message}`);
    });
  }

  /**
   * 필요한 버킷 존재 여부 확인 및 생성
   */
  async ensureBuckets(): Promise<void> {
    const buckets = [this.bucketDocs, this.bucketAssets];
    for (const bucket of buckets) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error: unknown) {
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          try {
            await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
            this.logger.log(`MinIO 버킷 생성 완료: ${bucket}`);
          } catch (createErr) {
            this.logger.error(
              `버킷(${bucket}) 생성 실패: ${(createErr as Error).message}`,
            );
          }
        }
      }
    }
  }

  /**
   * 문서 저장용 버킷 명
   */
  get docsBucket(): string {
    return this.bucketDocs;
  }

  /**
   * 에셋/이미지 저장용 버킷 명
   */
  get assetsBucket(): string {
    return this.bucketAssets;
  }

  /**
   * 오브젝트 업로드 (문자열 또는 버퍼)
   */
  async putObject(
    bucket: string,
    key: string,
    body: string | Buffer,
    contentType = 'text/markdown; charset=utf-8',
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * 오브젝트를 문자열로 가져오기
   */
  async getObjectAsString(bucket: string, key: string): Promise<string> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        throw new NotFoundException(`오브젝트(${key}) 내용이 비어있습니다.`);
      }

      // Readable stream -> string 변환
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'NoSuchKey' || err.name === 'NotFound') {
        throw new NotFoundException(
          `스토리지에서 파일을 찾을 수 없습니다: ${key}`,
        );
      }
      throw error;
    }
  }

  /**
   * 오브젝트를 Readable 스트림으로 가져오기
   */
  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'NoSuchKey' || err.name === 'NotFound') {
        throw new NotFoundException(
          `스토리지에서 파일을 찾을 수 없습니다: ${key}`,
        );
      }
      throw error;
    }
  }

  /**
   * 오브젝트 삭제
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `오브젝트(${key}) 삭제 중 에러 무시: ${(error as Error).message}`,
      );
    }
  }
}
