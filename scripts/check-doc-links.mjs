import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = join(repositoryRoot, 'site');
const basePath = '/sdcorejs-nestjs/';

function walk(root, extension) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.vitepress') return walk(path, extension);
    return entry.isFile() && path.endsWith(extension) ? [path] : [];
  });
}

function routeFor(file) {
  const path = relative(siteRoot, file).split(sep).join('/').replace(/\.md$/, '');
  if (path === 'index') return '/';
  return path.endsWith('/index') ? `/${path.slice(0, -5)}` : `/${path}`;
}

function canonicalRoute(pathname) {
  let path = decodeURIComponent(pathname).replace(/\/+/g, '/');
  if (path.startsWith(basePath)) path = `/${path.slice(basePath.length)}`;
  path = path.replace(/\.(?:md|html)$/, '');
  if (path.endsWith('/index')) path = path.slice(0, -5);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
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

function anchorsFor(markdown) {
  const anchors = new Set();
  const used = new Map();
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const explicit = /\s+\{#([A-Za-z0-9_-]+)\}\s*$/.exec(match[2]);
    if (explicit) {
      anchors.add(explicit[1]);
      continue;
    }
    const title = match[2]
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      // Keep underscores so this matches VitePress for code/literal heading text.
      .replace(/[*~]/g, '');
    const base = slugify(title);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

function frontmatterUrls(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!frontmatter) return [];
  return [...frontmatter.matchAll(/^\s*(?:link|src):\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
}

const markdownFiles = walk(siteRoot, '.md');
const routes = new Map(markdownFiles.map((file) => [canonicalRoute(routeFor(file)), file]));
const anchors = new Map(markdownFiles.map((file) => [file, anchorsFor(readFileSync(file, 'utf8'))]));
const errors = [];
const repositoryMarkdownFiles = [
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  '.changeset/README.md',
  'docs/migration-1.0.md',
  'docs/migration-1.1-security-hardening.md',
  'docs/migration-from-core-be.md',
  'examples/README.md',
].map((path) => join(repositoryRoot, path));

function validateLink(source, href, label) {
  const raw = href.trim().replace(/^<|>$/g, '');
  if (!raw || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) return;
  let url;
  try {
    url = new URL(raw, `https://docs.invalid${routeFor(source)}`);
  } catch {
    errors.push(`${relative(repositoryRoot, source)}: invalid ${label} '${raw}'`);
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  const route = canonicalRoute(pathname);
  const target = routes.get(route);
  if (target) {
    if (url.hash) {
      const anchor = decodeURIComponent(url.hash.slice(1));
      if (anchor && !anchors.get(target)?.has(anchor)) {
        errors.push(`${relative(repositoryRoot, source)}: missing anchor '#${anchor}' in ${relative(repositoryRoot, target)}`);
      }
    }
    return;
  }

  const extension = extname(pathname);
  if (extension && !['.md', '.html'].includes(extension) && !/^\.\d+$/.test(extension)) {
    const targets = raw.startsWith('/')
      ? [join(siteRoot, 'public', pathname.replace(/^\//, '')), join(siteRoot, pathname.replace(/^\//, ''))]
      : [resolve(dirname(source), pathname)];
    if (!targets.some((target) => existsSync(target))) {
      errors.push(`${relative(repositoryRoot, source)}: missing asset '${raw}'`);
    }
    return;
  }

  errors.push(`${relative(repositoryRoot, source)}: missing page '${raw}' (resolved ${route})`);
}

for (const file of markdownFiles) {
  const markdown = readFileSync(file, 'utf8');
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) {
    validateLink(file, match[1], 'Markdown link');
  }
  for (const match of markdown.matchAll(/\b(?:href|src)\s*=\s*['"]([^'"]+)['"]/gi)) {
    validateLink(file, match[1], 'HTML link');
  }
  for (const url of frontmatterUrls(markdown)) {
    validateLink(file, url, 'frontmatter URL');
  }
}

function validateRepositoryFileLink(source, href) {
  const raw = href.trim().replace(/^<|>$/g, '');
  if (!raw || /^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) return;
  const path = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  if (!path) return;
  const target = resolve(dirname(source), path);
  if (!existsSync(target)) {
    errors.push(`${relative(repositoryRoot, source)}: missing repository file '${raw}'`);
  }
}

for (const file of repositoryMarkdownFiles) {
  if (!existsSync(file)) {
    errors.push(`required repository documentation is missing: ${relative(repositoryRoot, file)}`);
    continue;
  }
  const markdown = readFileSync(file, 'utf8');
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) {
    validateRepositoryFileLink(file, match[1]);
  }
}

const navigationFile = join(siteRoot, '.vitepress', 'navigation.mjs');
const { navigationLinks } = await import(pathToFileURL(navigationFile).href);
for (const [locale, links] of Object.entries(navigationLinks())) {
  const source = join(siteRoot, ...(locale === 'vi' ? ['vi', 'index.md'] : ['index.md']));
  for (const link of links) validateLink(source, link, `${locale} navigation link`);
}

if (errors.length) {
  console.error(`Documentation link check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}

console.log(
  `Documentation link check passed: ${markdownFiles.length} site pages/routes and ${repositoryMarkdownFiles.length} repository documents.`,
);
