import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class TagResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 태그 이름 배열을 받아 존재하지 않으면 생성하고 태그 ID 목록 반환 (트랜잭션 지원)
   */
  async resolveTags(
    ownerId: string,
    tagNames: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx || this.prisma;
    const cleanNames = Array.from(
      new Set(tagNames.map((name) => name.trim().toLowerCase()).filter(Boolean)),
    );

    if (cleanNames.length === 0) {
      return [];
    }

    const tagIds: string[] = [];

    for (const name of cleanNames) {
      let tag = await client.tag.findFirst({
        where: { name, ownerId },
      });

      if (!tag) {
        tag = await client.tag.create({
          data: { name, ownerId },
        });
      }

      tagIds.push(tag.id);
    }

    return tagIds;
  }
}
