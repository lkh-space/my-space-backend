import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TagResolverService } from './tag-resolver.service.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';

describe('TagResolverService', () => {
  let service: TagResolverService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      tag: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
    } as unknown as PrismaService;

    service = new TagResolverService(prisma);
  });

  describe('resolveTags', () => {
    it('태그 목록을 정규화하고 createMany와 findMany로 원자적 해석해야 한다', async () => {
      // given
      const ownerId = 'user-1';
      const tagNames = ['  TypeScript  ', 'NESTJS', 'typescript'];

      vi.mocked(prisma.tag.createMany).mockResolvedValueOnce({ count: 2 } as never);
      vi.mocked(prisma.tag.findMany).mockResolvedValueOnce([
        { id: 't-ts', name: 'typescript' },
        { id: 't-nest', name: 'nestjs' },
      ] as never);

      // when
      const ids = await service.resolveTags(ownerId, tagNames);

      // then
      expect(ids).toEqual(['t-ts', 't-nest']);
      expect(prisma.tag.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'typescript', ownerId },
          { name: 'nestjs', ownerId },
        ],
        skipDuplicates: true,
      });
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { ownerId, name: { in: ['typescript', 'nestjs'] } },
        select: { id: true, name: true },
      });
    });

    it('유효한 태그 이름이 없으면 빈 배열을 반환해야 한다', async () => {
      // given
      const ownerId = 'user-1';

      // when
      const result = await service.resolveTags(ownerId, ['   ', '']);

      // then
      expect(result).toEqual([]);
      expect(prisma.tag.createMany).not.toHaveBeenCalled();
      expect(prisma.tag.findMany).not.toHaveBeenCalled();
    });
  });
});
