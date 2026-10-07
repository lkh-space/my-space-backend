import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';

@Injectable()
export class TestService {
  constructor(private readonly prisma: PrismaService) {}

  public async cleanDatabase(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        TRUNCATE TABLE "document_revisions", "document_tags", "documents", "folders", "tags" RESTART IDENTITY CASCADE;
      `);
    } catch (error) {
      console.error('[TestService] cleanDatabase error:', error);
    }
  }
}
