import { addDays, isBlank, slugify, toMb } from './utils';

describe('uploaded-file/utils', () => {
  describe('slugify', () => {
    it('lowercases, strips Vietnamese diacritics, keeps the extension dot', () => {
      expect(slugify('Hợp Đồng.PDF')).toBe('hop-dong.pdf');
    });
    it('maps đ/Đ to d', () => {
      expect(slugify('đơn-hàng.docx')).toBe('don-hang.docx');
    });
    it('strips spaces + unsafe chars and keeps a filesystem-safe extension', () => {
      const out = slugify('a b!!.txt');
      expect(out).toMatch(/^[a-z0-9._-]+$/);
      expect(out.endsWith('.txt')).toBe(true);
      expect(out).not.toMatch(/[ !]/);
    });
    it('falls back to TEMP for empty input', () => {
      expect(slugify('')).toBe('temp');
    });
  });

  describe('isBlank', () => {
    it.each([
      ['', true],
      ['   ', true],
      [undefined, true],
      [null, true],
      ['x', false],
    ])('isBlank(%p) === %p', (input, expected) => {
      expect(isBlank(input as string | undefined | null)).toBe(expected);
    });
  });

  describe('toMb', () => {
    it('rounds bytes to whole MB', () => {
      expect(toMb(1048576)).toBe(1);
      expect(toMb(1572864)).toBe(2); // 1.5MB rounds up
      expect(toMb(0)).toBe(0);
    });
  });

  describe('addDays', () => {
    it('adds N days without mutating the input', () => {
      const base = new Date('2026-01-01T00:00:00.000Z');
      const out = addDays(base, 1);
      expect(out.toISOString()).toBe('2026-01-02T00:00:00.000Z');
      expect(base.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
