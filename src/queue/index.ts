export * from './types';
export * from './queue.module';
export * from './base-worker';

// Convenience re-exports so queue code imports from one place (@sdcorejs/nestjs/queue) instead of
// reaching into @nestjs/bullmq + bullmq directly.
export { Processor, InjectQueue, OnWorkerEvent, OnQueueEvent } from '@nestjs/bullmq';
export type { Job, Queue, Worker, JobsOptions } from 'bullmq';
