import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDING, createBrandHead, createLocaleBrandHead, DOCS_BASE, DOCS_URL } from '../../site/.vitepress/branding';

const projectRoot = join(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('documentation branding', () => {
  it.each([
    ['sdcorejs-logo.png', 368, 368],
    ['sdcorejs-wordmark.png', 629, 240],
    ['sdcorejs-lockup.png', 866, 368],
  ] as const)('publishes %s with its original dimensions', (name, width, height) => {
    const image = readFileSync(join(projectRoot, 'site/public/images', name));

    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(width);
    expect(image.readUInt32BE(20)).toBe(height);
  });

  it('uses base-safe favicon and absolute social image URLs', () => {
    expect(BRANDING.favicon).toBe(`${DOCS_BASE}images/sdcorejs-logo.png`);
    expect(BRANDING.socialImage).toBe(`${DOCS_URL}images/sdcorejs-lockup.png`);

    expect(createBrandHead()).toEqual(
      expect.arrayContaining([
        ['link', expect.objectContaining({ rel: 'icon', href: BRANDING.favicon })],
        ['meta', expect.objectContaining({ property: 'og:image', content: BRANDING.socialImage })],
        ['meta', expect.objectContaining({ name: 'twitter:image', content: BRANDING.socialImage })],
      ]),
    );

    expect(createLocaleBrandHead('vi')).toEqual(
      expect.arrayContaining([
        ['meta', expect.objectContaining({ property: 'og:locale', content: 'vi_VN' })],
        [
          'meta',
          expect.objectContaining({
            property: 'og:image:alt',
            content: 'Biểu trưng và tên thương hiệu SDCoreJS',
          }),
        ],
      ]),
    );
  });

  it('uses the wordmark in navigation and the logo in both localized heroes', () => {
    const config = readProjectFile('site/.vitepress/config.ts');
    expect(config).toContain('logo: { src: BRANDING.navLogo, alt: BRANDING.name }');
    expect(config).toContain('siteTitle: BRANDING.navTitle');

    for (const home of ['site/index.md', 'site/vi/index.md']) {
      expect(readProjectFile(home)).toContain(`src: ${BRANDING.heroLogo}`);
    }
  });

  it('applies accessible brand colors and hero treatments', () => {
    const styles = readProjectFile('site/.vitepress/theme/styles.css');
    expect(styles).toContain(`--vp-c-brand-1: ${BRANDING.primaryColor};`);
    expect(styles).toContain('--vp-home-hero-name-background:');
    expect(styles).toContain('.dark .VPHero .image-src');
  });
});
