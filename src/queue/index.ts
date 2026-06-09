export * from './types';
export * from './queue.module';
export * from './base-worker';

// Intentional third-party re-export (policy: gather a third-party surface, never re-export a
// sibling @sdcorejs/* package). Consumers import queue primitives from one place rather than
// reaching into @nestjs/bullmq + bullmq directly.
export { Processor, InjectQueue, OnWorkerEvent, OnQueueEvent } from '@nestjs/bullmq';
export type { Job, Queue, Worker, JobsOptions } from 'bullmq';
