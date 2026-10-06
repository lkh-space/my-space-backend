import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('PostgreSQL (Prisma) 연결 성공');
    } catch (error) {
      this.logger.error(
        `PostgreSQL (Prisma) 연결 실패: ${(error as Error).message}`,
      );
      // 로컬 개발이나 테스트 환경에서 DB가 아직 안 떴을 경우 즉시 크래시되지 않도록 경고만 출력
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('PostgreSQL (Prisma) 연결 종료');
  }
}
