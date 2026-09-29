import { describe, expect, it } from 'vitest';
import { projectResourcePath } from './project-resource-path.js';
describe('project resource paths', () => {
  it('normalizes only absolute paths inside the bound workspace', () => {
    expect(projectResourcePath('D:/project', 'd:/project/src/games')).toBe('src/games');
    expect(projectResourcePath('D:/project', 'D:\\project\\src\\main.ts')).toBe('src/main.ts');
    expect(projectResourcePath('D:/project', 'D:/project')).toBe('.');
    expect(projectResourcePath('D:/project', 'D:/project-other/key')).toBe('D:/project-other/key');
    expect(projectResourcePath('/project', '/Project/file')).toBe('/Project/file');
    expect(projectResourcePath('/project', 'src/main.ts')).toBe('src/main.ts');
    expect(projectResourcePath('/project', '../outside')).toBe('../outside');
  });
});
