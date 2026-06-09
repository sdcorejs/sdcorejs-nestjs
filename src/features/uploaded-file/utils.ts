/** Self-contained helpers replacing the consumer's global String/Number/Date extensions. */

/** ASCII-slugify a filename, preserving the extension dot. Mirrors the legacy `String.slugify`. */
export function slugify(input: string): string {
  return (input || 'TEMP')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^a-zA-Z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function isBlank(value: string | undefined | null): boolean {
  return !value || !value.trim();
}

/** Size in MB rounded to a whole number (matches the legacy `Number.round(bytes / 1048576)`). */
export function toMb(bytes: number): number {
  return Math.round(bytes / 1048576);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
