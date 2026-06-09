import { SetMetadata } from '@nestjs/common';
import { PERMISSION_METADATA_KEY } from '../tokens';

/**
 * Require a single permission code. Convention `resource:action` is encouraged but not enforced.
 *
 * @example
 * @HasPermission('product:create')
 * @Post()
 * create(@Body() dto: CreateDto) {}
 */
export const HasPermission = (code: string) => SetMetadata(PERMISSION_METADATA_KEY, [code]);
