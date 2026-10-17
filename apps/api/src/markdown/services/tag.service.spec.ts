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
        createMany: vi.fn(),
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
    it('태그 목록을 소문자 정규화 및 중복 제거 후 createMany와 findMany로 원자적 해석해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const tagNames = ['  NestJS  ', 'newtag', 'nestjs', ''];

      vi.mocked(prisma.tag.createMany).mockResolvedValueOnce({ count: 1 } as never);
      vi.mocked(prisma.tag.findMany).mockResolvedValueOnce([
        { id: 't-2', name: 'newtag' },
        { id: 't-1', name: 'nestjs' },
      ] as never);

      // when
      const ids = await service.resolveTags(ownerId, tagNames);

      // then
      expect(ids).toEqual(['t-1', 't-2']);
      expect(prisma.tag.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'nestjs', ownerId },
          { name: 'newtag', ownerId },
        ],
        skipDuplicates: true,
      });
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { ownerId, name: { in: ['nestjs', 'newtag'] } },
        select: { id: true, name: true },
      });
    });

    it('태그 배열이 비어있거나 공백뿐이면 DB 호출 없이 빈 배열을 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';

      // when
      const result = await service.resolveTags(ownerId, ['   ', '']);

      // then
      expect(result).toEqual([]);
      expect(prisma.tag.createMany).not.toHaveBeenCalled();
      expect(prisma.tag.findMany).not.toHaveBeenCalled();
    });
  });
});
