import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpService } from '@sdcorejs/nestjs/services';

const catalogSnapshotSchema = z.object({
  revision: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
});

export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

@Injectable()
export class CatalogSourceClient {
  constructor(private readonly http: HttpService) {}

  async fetchSnapshot(): Promise<CatalogSnapshot> {
    const response = await this.http.get<unknown>('/v1/catalog/snapshot');
    return catalogSnapshotSchema.parse(response);
  }
}
