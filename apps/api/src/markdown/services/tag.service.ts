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

    // 1. 신규 태그 일괄 생성 (이미 존재하는 태그는 skipDuplicates로 무시하여 동시성 충돌 방어)
    await client.tag.createMany({
      data: cleanNames.map((name) => ({ name, ownerId })),
      skipDuplicates: true,
    });

    // 2. 전체 매칭 태그 일괄 조회 (단 1회 쿼리)
    const tags = await client.tag.findMany({
      where: { ownerId, name: { in: cleanNames } },
      select: { id: true, name: true },
    });

    // 3. 원래 cleanNames 순서 유지 매핑
    const tagMap = new Map(tags.map((t) => [t.name, t.id]));
    return cleanNames
      .map((name) => tagMap.get(name))
      .filter((id): id is string => Boolean(id));
  }
}
