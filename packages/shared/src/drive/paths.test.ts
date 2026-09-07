import { describe, expect, it } from 'vitest';
import { collectDriveUploadDirectories, driveUploadParentPath } from './paths';
import { driveRelativePathSchema, ensureDriveDirectoriesSchema } from './validation';

describe('directory upload paths', () => {
  it('deduplicates ancestors and orders parents before children', () => {
    expect(collectDriveUploadDirectories(['root/b/file.txt', 'root/a/file.txt', 'root/b/second.txt', 'plain.txt']))
      .toEqual(['root', 'root/a', 'root/b']);
    expect(driveUploadParentPath('plain.txt')).toBe('');
    expect(driveUploadParentPath('root/a/file.txt')).toBe('root/a');
  });
  it.each(['../secret', 'root/../secret', '/absolute', 'a//b', 'C:\\file', 'root/\u0000file'])('rejects unsafe path %j', (path) => {
    expect(driveRelativePathSchema.safeParse(path).success).toBe(false);
  });
  it('bounds depth and accepts Unicode names', () => {
    expect(driveRelativePathSchema.parse('\u9879\u76ee/file.txt')).toBe('\u9879\u76ee/file.txt');
    expect(driveRelativePathSchema.safeParse(Array(33).fill('a').join('/')).success).toBe(false);
    expect(ensureDriveDirectoriesSchema.parse({ spaceId: 1, paths: ['root/a'] }).parentId).toBeNull();
  });
});
