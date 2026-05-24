// Re-export filter/paging/order types from @sdcorejs/utils (single source of truth).
export type {
  Filter,
  FilterHasData,
  FilterBetween,
  FilterNoData,
  FilterAndOr,
  Operator,
  OperatorHasData,
  OperatorNoData,
  Order,
  PagingReq,
  PagingRes,
  QueryReq,
  NestedKeyOf,
} from '@sdcorejs/utils/models';

// Aliases kept for migration compatibility with `be-masterdata/core-be` call sites.
import type {
  Filter as _Filter,
  Operator as _Operator,
  Order as _Order,
  PagingReq as _PagingReq,
  PagingRes as _PagingRes,
} from '@sdcorejs/utils/models';

export type SdFilter<T = unknown> = _Filter<T>;
export type SdFilterOperator = _Operator;
export type SdOrder<T = unknown> = _Order<T>;
export type SdPagingReq<T = unknown> = _PagingReq<T>;
export type SdPagingRes<T = unknown> = _PagingRes<T>;

// Library-local types (not in @sdcorejs/utils):
export * from './repository-args.types';
export * from './dto.types';
export * from './api-response.types';
export * from './user-snapshot.types';
export * from './class-ref.types';
