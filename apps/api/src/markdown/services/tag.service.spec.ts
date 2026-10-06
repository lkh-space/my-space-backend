import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TagService } from './tag.service.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';

describe('TagService', () => {
  let service: TagService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      tag: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as PrismaService;

    service = new TagService(prisma);
  });

  describe('getTags', () => {
    it('사용자의 태그 목록과 문서 수를 올바르게 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      vi.mocked(prisma.tag.findMany).mockResolvedValueOnce([
        {
          id: 't-1',
          name: 'backend',
          ownerId,
          createdAt: new Date(),
          _count: { documents: 3 },
        },
        {
          id: 't-2',
          name: 'nestjs',
          ownerId,
          createdAt: new Date(),
          _count: { documents: 7 },
        },
      ] as never);

      // when
      const result = await service.getTags(ownerId);

      // then
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('backend');
      expect(result[0].documentCount).toBe(3);
      expect(result[1].name).toBe('nestjs');
      expect(result[1].documentCount).toBe(7);
    });
  });

  describe('resolveTags', () => {
    it('기존 태그가 있으면 해당 ID를 반환하고, 없으면 새로 생성하여 ID를 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const tagNames = ['NestJS', 'NewTag'];

      // 'nestjs'는 존재함
      vi.mocked(prisma.tag.findFirst)
        .mockResolvedValueOnce({
          id: 't-1',
          name: 'nestjs',
          ownerId,
          createdAt: new Date(),
        })
        // 'newtag'는 존재하지 않음
        .mockResolvedValueOnce(null);

      vi.mocked(prisma.tag.create).mockResolvedValueOnce({
        id: 't-2',
        name: 'newtag',
        ownerId,
        createdAt: new Date(),
      });

      // when
      const ids = await service.resolveTags(ownerId, tagNames);

      // then
      expect(ids).toEqual(['t-1', 't-2']);
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: { name: 'newtag', ownerId },
      });
    });
  });
});
