import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderService } from './folder.service.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import {
  FolderNotFoundException,
  FolderAlreadyExistsException,
  FolderCyclicDependencyException,
} from '../exceptions/markdown.exception.js';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      folder: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $queryRaw: vi.fn(),
    } as unknown as PrismaService;

    service = new FolderService(prisma);
  });

  describe('createFolder', () => {
    it('루트 폴더를 정상적으로 생성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Architecture' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.folder.create).mockResolvedValueOnce({
        id: 'f-1',
        name: 'Architecture',
        parentId: null,
        ownerId,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
      });

      // when
      const result = await service.createFolder(ownerId, dto);

      // then
      expect(result.id).toBe('f-1');
      expect(result.name).toBe('Architecture');
      expect(result.parentId).toBeNull();
      expect(result.children).toEqual([]);
    });

    it('동일 경로에 동일 이름의 폴더가 이미 있으면 FolderAlreadyExistsException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Architecture' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: 'f-existing',
        name: 'Architecture',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // when & then
      await expect(service.createFolder(ownerId, dto)).rejects.toThrow(
        FolderAlreadyExistsException,
      );
    });

    it('동시 요청으로 DB에서 P2002 유니크 제약 충돌이 발생하면 FolderAlreadyExistsException으로 변환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Architecture' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);
      const p2002Error = new Error('Unique constraint failed') as any;
      p2002Error.code = 'P2002';
      Object.setPrototypeOf(
        p2002Error,
        (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype,
      );
      vi.mocked(prisma.folder.create).mockRejectedValueOnce(p2002Error);

      // when & then
      await expect(service.createFolder(ownerId, dto)).rejects.toThrow(
        FolderAlreadyExistsException,
      );
    });

    it('상위 부모 폴더가 존재하지 않으면 FolderNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Sub', parentId: 'non-existent-parent' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(service.createFolder(ownerId, dto)).rejects.toThrow(
        FolderNotFoundException,
      );
    });
  });

  describe('getFolderTree', () => {
    it('평탄한 폴더 목록을 계층 트리 구조로 올바르게 재구성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const rawFolders = [
        {
          id: 'root-1',
          name: 'Architecture',
          parentId: null,
          ownerId,
          createdAt: new Date('2026-10-05T10:00:00Z'),
          updatedAt: new Date('2026-10-05T10:00:00Z'),
        },
        {
          id: 'sub-1',
          name: 'Backend',
          parentId: 'root-1',
          ownerId,
          createdAt: new Date('2026-10-05T10:05:00Z'),
          updatedAt: new Date('2026-10-05T10:05:00Z'),
        },
        {
          id: 'root-2',
          name: 'Frontend',
          parentId: null,
          ownerId,
          createdAt: new Date('2026-10-05T10:10:00Z'),
          updatedAt: new Date('2026-10-05T10:10:00Z'),
        },
      ];

      vi.mocked(prisma.folder.findMany).mockResolvedValueOnce(rawFolders);

      // when
      const tree = await service.getFolderTree(ownerId);

      // then
      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('root-1');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('sub-1');
      expect(tree[1].id).toBe('root-2');
      expect(tree[1].children).toHaveLength(0);
    });
  });

  describe('updateFolder', () => {
    it('자기 자신을 부모로 설정하려고 하면 FolderCyclicDependencyException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-1';
      const dto = { parentId: 'f-1' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: folderId,
        name: 'Root',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // when & then
      await expect(
        service.updateFolder(ownerId, folderId, dto),
      ).rejects.toThrow(FolderCyclicDependencyException);
    });

    it('재귀 CTE 쿼리 결과 순환 조상 체인이 발견되면 FolderCyclicDependencyException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-root';
      const newParentId = 'f-child';
      const dto = { parentId: newParentId };

      vi.mocked(prisma.folder.findFirst)
        .mockResolvedValueOnce({
          id: folderId,
          name: 'Root',
          parentId: null,
          ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: newParentId,
          name: 'Child',
          parentId: folderId,
          ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      // 재귀 CTE에서 f-root가 조상 체인에 존재함을 반환
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ exists: 1 }] as never);

      // when & then
      await expect(
        service.updateFolder(ownerId, folderId, dto),
      ).rejects.toThrow(FolderCyclicDependencyException);
    });

    it('순환 참조가 없고 중복이 없으면 정상적으로 부모 폴더를 이동해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-child';
      const newParentId = 'f-other-parent';
      const dto = { parentId: newParentId };

      vi.mocked(prisma.folder.findFirst)
        .mockResolvedValueOnce({
          id: folderId,
          name: 'Child',
          parentId: 'f-old-parent',
          ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: newParentId,
          name: 'Other Parent',
          parentId: null,
          ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce(null);

      // 재귀 CTE에서 순환 체인 미발견
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);

      vi.mocked(prisma.folder.update).mockResolvedValueOnce({
        id: folderId,
        name: 'Child',
        parentId: newParentId,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // when
      const updated = await service.updateFolder(ownerId, folderId, dto);

      // then
      expect(updated.parentId).toBe(newParentId);
      expect(prisma.folder.update).toHaveBeenCalledWith({
        where: { id: folderId },
        data: { name: 'Child', parentId: newParentId },
      });
    });
  });

  describe('deleteFolder', () => {
    it('폴더가 존재하면 삭제를 정상 수행해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-1';

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: folderId,
        name: 'Root',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.folder.delete).mockResolvedValueOnce({} as never);

      // when
      await service.deleteFolder(ownerId, folderId);

      // then
      expect(prisma.folder.delete).toHaveBeenCalledWith({
        where: { id: folderId },
      });
    });

    it('존재하지 않는 폴더 삭제 요청 시 FolderNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'not-found';

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(service.deleteFolder(ownerId, folderId)).rejects.toThrow(
        FolderNotFoundException,
      );
    });
  });
});
