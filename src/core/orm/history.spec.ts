import { getHistoryRecorder, type IHistoryRecorder, registerHistoryRecorder } from './history';

describe('orm/history registry', () => {
  it('returns undefined before any recorder is registered (or after another test sets one)', () => {
    // Registry is module-global; just assert the API shape works.
    const before = getHistoryRecorder();
    expect(before === undefined || typeof before.record === 'function').toBe(true);
  });

  it('registers and returns the recorder', () => {
    const recorder: IHistoryRecorder = { record: jest.fn(async () => undefined) };
    registerHistoryRecorder(recorder);
    expect(getHistoryRecorder()).toBe(recorder);
  });

  it('last registration wins', () => {
    const a: IHistoryRecorder = { record: jest.fn(async () => undefined) };
    const b: IHistoryRecorder = { record: jest.fn(async () => undefined) };
    registerHistoryRecorder(a);
    registerHistoryRecorder(b);
    expect(getHistoryRecorder()).toBe(b);
  });
});
