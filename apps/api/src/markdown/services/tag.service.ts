import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { TagResponseDto } from '../dto/tag.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class TagService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 사용자의 전체 태그 및 연결된 문서 수 조회
   */
  async getTags(ownerId: string): Promise<TagResponseDto[]> {
    const tags = await this.prisma.tag.findMany({
      where: { ownerId },
      include: {
        _count: {
          select: { documents: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return tags.map(
      (t: any) =>
        new TagResponseDto({
          id: t.id,
          name: t.name,
          documentCount: t._count.documents,
        }),
    );
  }

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
