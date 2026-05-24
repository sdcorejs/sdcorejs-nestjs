// Re-export commonly-used helpers from @sdcorejs/utils for ergonomic import sites.
export {
  ValidationUtilities,
  ArrayUtilities,
  StringUtilities,
  Utilities,
} from '@sdcorejs/utils/fns';

// Shortcut helpers — call into the utils namespaces directly.
import { ValidationUtilities } from '@sdcorejs/utils/fns';
import { ArrayUtilities } from '@sdcorejs/utils/fns';

/** UUID v1-v5 strict validator. Delegates to {@link ValidationUtilities.isUuid}. */
export const isUuid = ValidationUtilities.isUuid;

/** Returns array with duplicates removed (reference equality). Delegates to {@link ArrayUtilities.distinct}. */
export const unique = ArrayUtilities.distinct;
export const distinct = ArrayUtilities.distinct;

// Library-local helpers (not in @sdcorejs/utils):
export * from './object';
