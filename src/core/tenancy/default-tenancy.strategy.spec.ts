import { DefaultTenancyStrategy } from './default-tenancy.strategy';

describe('DefaultTenancyStrategy', () => {
  const s = new DefaultTenancyStrategy();
  it('getCurrentScope returns empty object', () => {
    expect(s.getCurrentScope()).toEqual({});
  });
  it('shouldBypass returns false (scoped entities fail closed)', () => {
    expect(s.shouldBypass()).toBe(false);
  });
});
