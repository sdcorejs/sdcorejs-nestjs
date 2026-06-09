import { DefaultPermissionStrategy } from './default-permission.strategy';

describe('DefaultPermissionStrategy', () => {
  const s = new DefaultPermissionStrategy();
  it('load returns empty codes (deny-all)', async () => {
    expect(await s.load()).toEqual([]);
  });
  it('check delegates to Array.includes', () => {
    expect(s.check(['a', 'b'], 'a')).toBe(true);
    expect(s.check(['a', 'b'], 'c')).toBe(false);
  });
});
