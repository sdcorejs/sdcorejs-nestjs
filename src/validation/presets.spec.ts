import 'reflect-metadata';
import { zPaging, zPageNumber, zPageSize, zUuid, zBool } from './presets';

describe('zod query presets', () => {
  describe('zPaging', () => {
    it('coerces string page numbers and applies defaults', () => {
      expect(zPaging.parse({ pageNumber: '2', pageSize: '50' })).toEqual({ pageNumber: 2, pageSize: 50 });
      expect(zPaging.parse({})).toEqual({ pageNumber: 0, pageSize: 10 });
    });

    it('clamps page size at the upper bound', () => {
      expect(() => zPaging.parse({ pageSize: '5000' })).toThrow();
    });

    it('rejects negative page number', () => {
      expect(() => zPageNumber.parse('-1')).toThrow();
    });

    it('rejects page size below 1', () => {
      expect(() => zPageSize.parse('0')).toThrow();
    });
  });

  describe('zUuid', () => {
    it('accepts a valid uuid', () => {
      const id = '11111111-1111-4111-8111-111111111111';
      expect(zUuid().parse(id)).toBe(id);
    });
    it('rejects a non-uuid with the i18n code message', () => {
      const r = zUuid('core.validation.uuid').safeParse('not-a-uuid');
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe('core.validation.uuid');
    });
  });

  describe('zBool', () => {
    it('coerces truthy query strings to true', () => {
      expect(zBool.parse('true')).toBe(true);
      expect(zBool.parse('1')).toBe(true);
      expect(zBool.parse('yes')).toBe(true);
    });
    it('coerces other strings to false', () => {
      expect(zBool.parse('false')).toBe(false);
      expect(zBool.parse('0')).toBe(false);
    });
    it('passes through real booleans', () => {
      expect(zBool.parse(true)).toBe(true);
    });
  });
});
