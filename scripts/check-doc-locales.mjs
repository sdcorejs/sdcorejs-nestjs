import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = join(repositoryRoot, 'site');
const vietnameseRoot = join(siteRoot, 'vi');
const internalPageRoots = new Set(['guide', 'api', 'examples', 'reference', 'releases', 'migrations']);
const mojibakePattern =
  /\ufffd|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00c4[\u0080-\u024f]|\u00c5[\u0080-\u024f]|\u00c6[\u0080-\u024f]|\u00e1[\u00ba\u00bb]|\u00e2[\u0080-\u00bf\u2020\u20ac\u2122]/u;

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.vitepress') return walk(path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

function normalizedRelative(root, file) {
  return relative(root, file).split(sep).join('/');
}

function routeFor(file) {
  const path = normalizedRelative(siteRoot, file).replace(/\.md$/, '');
  if (path === 'index') return '/';
  return path.endsWith('/index') ? `/${path.slice(0, -5)}` : `/${path}`;
}

function canonicalRoute(pathname) {
  let path = decodeURIComponent(pathname)
    .replace(/\/{2,}/g, '/')
    .replace(/\.(?:md|html)$/, '');
  if (path.endsWith('/index')) path = path.slice(0, -5);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

function fencedBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (!open) continue;
    const marker = open[1][0];
    const minimum = open[1].length;
    const block = [lines[index]];
    index += 1;
    while (index < lines.length) {
      block.push(lines[index]);
      if (new RegExp(`^\\s*${marker}{${minimum},}\\s*$`).test(lines[index])) break;
      index += 1;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function withoutFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  const kept = [];
  let marker;
  let minimum = 0;
  for (const line of lines) {
    if (!marker) {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (open) {
        marker = open[1][0];
        minimum = open[1].length;
      } else kept.push(line);
      continue;
    }
    if (new RegExp(`^\\s*${marker}{${minimum},}\\s*$`).test(line)) {
      marker = undefined;
      minimum = 0;
    }
  }
  return kept.join('\n');
}

function inlineCode(markdown) {
  const source = withoutFences(markdown).replace(/<!--[\s\S]*?-->/g, '');
  const spans = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '`') {
      index += 1;
      continue;
    }

    let openingEnd = index;
    while (source[openingEnd] === '`') openingEnd += 1;
    const markerLength = openingEnd - index;
    let cursor = openingEnd;
    let matched = false;

    while (cursor < source.length) {
      const closingStart = source.indexOf('`', cursor);
      if (closingStart < 0) break;
      let closingEnd = closingStart;
      while (source[closingEnd] === '`') closingEnd += 1;
      if (closingEnd - closingStart === markerLength) {
        let value = source.slice(openingEnd, closingStart).replace(/\r\n?|\n/g, ' ');
        if (value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value)) value = value.slice(1, -1);
        spans.push(value);
        index = closingEnd;
        matched = true;
        break;
      }
      cursor = closingEnd;
    }

    if (!matched) index = openingEnd;
  }

  return spans;
}

const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'\u201c\u201d\u2018\u2019<>,.?/]+/g;
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

function headings(markdown) {
  const used = new Map();
  return withoutFences(markdown)
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) return [];
      const explicit = /\s+\{#([A-Za-z0-9_-]+)\}\s*$/.exec(match[2]);
      const title = match[2]
        .replace(/\s+\{#[A-Za-z0-9_-]+\}\s*$/, '')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        // Keep underscores so this matches VitePress for code/literal heading text.
        .replace(/[*~]/g, '');
      const base = slugify(title);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      return [{ anchor: explicit?.[1] ?? (count ? `${base}-${count}` : base), explicit: explicit?.[1], level: match[1].length }];
    });
}

function pageLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) links.push(match[1]);
  for (const match of markdown.matchAll(/\b(?:href|src)\s*=\s*['"]([^'"]+)['"]/gi)) links.push(match[1]);
  for (const match of markdown.matchAll(/^\s*link:\s*['"]?(\/[^'"\s]+)['"]?\s*$/gm)) links.push(match[1]);
  return links;
}

function isPagePath(pathname) {
  const normalized = canonicalRoute(pathname);
  if (normalized === '/' || normalized === '/vi') return true;
  const segments = normalized
    .replace(/^\/vi(?:\/|$)/, '/')
    .split('/')
    .filter(Boolean);
  return internalPageRoots.has(segments[0]);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

const englishFiles = walk(siteRoot).filter((file) => !file.startsWith(`${vietnameseRoot}${sep}`));
const vietnameseFiles = walk(vietnameseRoot);
const englishByPath = new Map(englishFiles.map((file) => [normalizedRelative(siteRoot, file), file]));
const vietnameseByPath = new Map(vietnameseFiles.map((file) => [normalizedRelative(vietnameseRoot, file), file]));
const routes = new Map([...englishFiles, ...vietnameseFiles].map((file) => [canonicalRoute(routeFor(file)), file]));
const errors = [];

for (const file of [
  ...englishFiles,
  ...vietnameseFiles,
  join(siteRoot, '.vitepress', 'config.ts'),
  join(siteRoot, '.vitepress', 'navigation.mjs'),
]) {
  if (mojibakePattern.test(readFileSync(file, 'utf8'))) {
    errors.push(`${normalizedRelative(repositoryRoot, file)}: probable UTF-8 mojibake detected`);
  }
}

for (const path of englishByPath.keys()) {
  if (!vietnameseByPath.has(path)) errors.push(`missing Vietnamese counterpart: site/vi/${path}`);
}
for (const path of vietnameseByPath.keys()) {
  if (!englishByPath.has(path)) errors.push(`Vietnamese route has no English source: site/vi/${path}`);
}

for (const [path, englishFile] of englishByPath) {
  const vietnameseFile = vietnameseByPath.get(path);
  if (!vietnameseFile) continue;
  const english = readFileSync(englishFile, 'utf8');
  const vietnamese = readFileSync(vietnameseFile, 'utf8');
  const englishFences = fencedBlocks(english);
  const vietnameseFences = fencedBlocks(vietnamese);
  if (englishFences.length !== vietnameseFences.length) {
    errors.push(`${path}: fenced block count differs (${englishFences.length} English, ${vietnameseFences.length} Vietnamese)`);
  } else {
    englishFences.forEach((block, index) => {
      if (hash(block) !== hash(vietnameseFences[index])) errors.push(`${path}: fenced block ${index + 1} changed in translation`);
    });
  }

  const englishInline = inlineCode(english);
  const vietnameseInline = inlineCode(vietnamese);
  if (englishInline.length !== vietnameseInline.length || englishInline.some((value, index) => value !== vietnameseInline[index])) {
    errors.push(`${path}: ordered inline-code sequence differs between locales`);
  }

  const englishHeadings = headings(english);
  const vietnameseHeadings = headings(vietnamese);
  if (
    englishHeadings.length !== vietnameseHeadings.length ||
    englishHeadings.some((heading, index) => heading.level !== vietnameseHeadings[index]?.level)
  ) {
    errors.push(`${path}: heading count or level order differs between locales`);
  }
  if (vietnameseHeadings.some((heading, index) => heading.explicit !== englishHeadings[index]?.anchor)) {
    errors.push(`${path}: every Vietnamese heading must retain its exact English-stable anchor`);
  }

  const vietnameseProse = withoutFences(vietnamese).replace(/`[^`\r\n]+`/g, '');
  if (!/[ăâđêôơưĂÂĐÊÔƠƯàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/u.test(vietnameseProse)) {
    errors.push(`${path}: Vietnamese page has no detectable Vietnamese prose`);
  }
}

for (const file of [...englishFiles, ...vietnameseFiles]) {
  const sourceIsVietnamese = file.startsWith(`${vietnameseRoot}${sep}`);
  const markdown = readFileSync(file, 'utf8');
  for (const href of pageLinks(markdown)) {
    const raw = href.trim().replace(/^<|>$/g, '');
    if (!raw || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) continue;
    let url;
    try {
      url = new URL(raw, `https://docs.invalid${routeFor(file)}`);
    } catch {
      continue;
    }
    if (!isPagePath(url.pathname) && !routes.has(canonicalRoute(url.pathname))) continue;
    const target = routes.get(canonicalRoute(url.pathname));
    if (!target) continue;
    const targetIsVietnamese = target.startsWith(`${vietnameseRoot}${sep}`);
    if (sourceIsVietnamese !== targetIsVietnamese) {
      errors.push(`${normalizedRelative(siteRoot, file)}: cross-locale internal link '${raw}'`);
    }
  }
}

const { navigationLinks } = await import(pathToFileURL(join(siteRoot, '.vitepress', 'navigation.mjs')).href);
const navigationRoutes = new Set();
for (const [locale, links] of Object.entries(navigationLinks())) {
  for (const link of links) {
    if (/^https?:/i.test(link)) continue;
    const route = canonicalRoute(link);
    navigationRoutes.add(route);
    const target = routes.get(route);
    if (!target) errors.push(`navigation ${locale}: missing page '${link}'`);
    else if ((locale === 'vi') !== target.startsWith(`${vietnameseRoot}${sep}`)) {
      errors.push(`navigation ${locale}: cross-locale page '${link}'`);
    }
  }
}

// Home is reachable through the site logo. cache-http is a retained compatibility route whose
// expanded Cache and Outbound HTTP guides are both present in the sidebar.
const intentionallyUnlistedRoutes = new Set(['/', '/vi', '/guide/cache-http', '/vi/guide/cache-http']);
for (const route of routes.keys()) {
  if (!navigationRoutes.has(route) && !intentionallyUnlistedRoutes.has(route)) {
    errors.push(`navigation: documentation page is orphaned from nav/sidebar '${route}'`);
  }
}

if (errors.length) {
  console.error(`Documentation locale check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}

console.log(
  `Documentation locale check passed: ${englishFiles.length} English + ${vietnameseFiles.length} Vietnamese routes, code/inline API parity, stable anchors, and locale-safe links.`,
);
