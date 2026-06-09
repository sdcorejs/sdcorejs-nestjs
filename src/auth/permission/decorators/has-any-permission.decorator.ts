import { SetMetadata } from '@nestjs/common';
import { PERMISSION_METADATA_KEY } from '../tokens';

/**
 * Require any one of the supplied permission codes (OR semantics). Useful when a single
 * endpoint serves multiple flows (e.g. owner OR admin can edit).
 *
 * @example
 * @HasAnyPermission('product:update', 'product:admin')
 * @Put(':id')
 * update() {}
 */
export const HasAnyPermission = (...codes: string[]) => SetMetadata(PERMISSION_METADATA_KEY, codes);
