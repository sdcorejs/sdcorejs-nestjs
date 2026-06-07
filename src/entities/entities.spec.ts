import { SD_CORE_ENTITIES, ActionHistory, JobScheduler, UploadedFile } from './index';

describe('entities barrel', () => {
  it('SD_CORE_ENTITIES lists the three concrete entities', () => {
    expect(SD_CORE_ENTITIES).toEqual([ActionHistory, JobScheduler, UploadedFile]);
  });

  it('UploadedFile is the renamed entity', () => {
    expect(UploadedFile.name).toBe('UploadedFile');
  });
});
