import { isUuid, unique, distinct, ValidationUtilities, ArrayUtilities, StringUtilities, Utilities } from './index';

describe('utils barrel re-exports @sdcorejs/utils', () => {
  it('isUuid alias matches ValidationUtilities.isUuid', () => {
    expect(isUuid).toBe(ValidationUtilities.isUuid);
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-uuid')).toBe(false);
  });

  it('unique + distinct alias matches ArrayUtilities.distinct', () => {
    expect(unique).toBe(ArrayUtilities.distinct);
    expect(distinct).toBe(ArrayUtilities.distinct);
    expect(unique([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
  });

  it('StringUtilities.aliasIncludes handles VN diacritics', () => {
    // 'phở bò' should match 'pho bo' after alias normalization
    expect(StringUtilities.aliasIncludes('Phở Bò', 'pho bo')).toBe(true);
  });

  it('Utilities namespace exposes generateUuid + hash', () => {
    expect(typeof Utilities.generateUuid()).toBe('string');
    expect(Utilities.hash({ a: 1, b: 2 })).toBe(Utilities.hash({ b: 2, a: 1 }));
  });
});
