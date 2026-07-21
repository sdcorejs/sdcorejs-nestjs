import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('documentation home layout', () => {
  it.each(['site/index.md', 'site/vi/index.md'])('groups home-page badges in %s', (path) => {
    expect(readProjectFile(path)).toContain('<p class="home-badges">');
  });

  it('loads a wrapping flex layout scoped to the home badges', () => {
    expect(readProjectFile('site/.vitepress/theme/index.ts')).toContain("import './styles.css';");

    const styles = readProjectFile('site/.vitepress/theme/styles.css');
    expect(styles).toMatch(/\.vp-doc \.home-badges\s*\{[^}]*display:\s*flex;/s);
    expect(styles).toMatch(/\.vp-doc \.home-badges\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });
});
