import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = join(repositoryRoot, 'site');
const vietnameseRoot = join(siteRoot, 'vi');

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036f]/g;
function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

function headingRecords(markdown) {
  const records = [];
  const used = new Map();
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, lineIndex) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    const title = match[2]
      .replace(/\s+\{#[A-Za-z0-9_-]+\}\s*$/, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      // Keep underscores: markdown-it preserves them inside code/literal text and VitePress
      // slugifies them as separators. Emphasis-boundary underscores produce the same slug.
      .replace(/[*~]/g, '');
    const base = slugify(title);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    records.push({ anchor: count ? `${base}-${count}` : base, level: match[1].length, lineIndex });
  });
  return records;
}

let updated = 0;
for (const vietnameseFile of walk(vietnameseRoot)) {
  const path = relative(vietnameseRoot, vietnameseFile);
  const englishFile = join(siteRoot, path);
  const englishHeadings = headingRecords(readFileSync(englishFile, 'utf8'));
  const vietnamese = readFileSync(vietnameseFile, 'utf8');
  const vietnameseHeadings = headingRecords(vietnamese);
  if (
    englishHeadings.length !== vietnameseHeadings.length ||
    englishHeadings.some((heading, index) => heading.level !== vietnameseHeadings[index]?.level)
  ) {
    throw new Error(`${path.split(sep).join('/')}: heading count or level order differs; anchors were not changed`);
  }
  const lines = vietnamese.split(/\r?\n/);
  vietnameseHeadings.forEach((heading, index) => {
    lines[heading.lineIndex] = `${lines[heading.lineIndex]
      .replace(/\s+\{#[A-Za-z0-9_-]+\}\s*$/, '')
      .replace(/\s+$/, '')} {#${englishHeadings[index].anchor}}`;
  });
  const next = lines.join('\n');
  if (next !== vietnamese) {
    writeFileSync(vietnameseFile, next, 'utf8');
    updated += 1;
  }
}

console.log(`Synchronized stable English anchors into ${updated} Vietnamese documentation pages.`);
