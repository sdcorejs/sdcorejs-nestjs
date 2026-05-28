import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueModule } from './queue.module';
import { SdWorkerHost } from './base-worker';

const fakeJob = (data: unknown): Job =>
  ({ id: '1', name: 'job', queueName: 'q', attemptsMade: 0, data }) as unknown as Job;

describe('QueueModule', () => {
  it('forRoot returns a global dynamic module wiring one Bull root import', () => {
    const m = QueueModule.forRoot({ connection: { host: 'h', port: 6379 } });
    expect(m.module).toBe(QueueModule);
    expect(m.global).toBe(true);
    expect(m.imports).toHaveLength(1);
    expect(m.exports).toHaveLength(1);
  });

  it('registerQueue imports + exports the queue registration', () => {
    const m = QueueModule.registerQueue('emails', 'reports');
    expect(m.module).toBe(QueueModule);
    expect(m.imports).toHaveLength(1);
    expect(m.exports).toHaveLength(1);
  });
});

describe('SdWorkerHost', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('delegates process() to handle() and returns its result', async () => {
    class Doubler extends SdWorkerHost<{ x: number }, number> {
      async handle(job: Job<{ x: number }, number>) {
        return job.data.x * 2;
      }
    }
    await expect(new Doubler().process(fakeJob({ x: 21 }))).resolves.toBe(42);
  });

  it('re-throws handle() errors so BullMQ applies retry/backoff', async () => {
    class Boom extends SdWorkerHost {
      async handle(): Promise<unknown> {
        throw new Error('boom');
      }
    }
    await expect(new Boom().process(fakeJob({}))).rejects.toThrow('boom');
  });
});
