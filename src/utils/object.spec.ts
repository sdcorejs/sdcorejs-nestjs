import { propertyOf } from './object';

interface User {
  id: string;
  username: string;
  email: string;
}

describe('propertyOf', () => {
  it('returns the key as a string', () => {
    expect(propertyOf<User>('id')).toBe('id');
    expect(propertyOf<User>('username')).toBe('username');
    expect(propertyOf<User>('email')).toBe('email');
  });

  it('result is a string at runtime', () => {
    const key = propertyOf<User>('email');
    expect(typeof key).toBe('string');
  });

  it('does NOT mutate Object.prototype', () => {
    expect((Object.prototype as { propertyOf?: unknown }).propertyOf).toBeUndefined();
  });
});
