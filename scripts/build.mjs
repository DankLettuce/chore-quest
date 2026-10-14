// Copies src/ to dist/ and stamps the service worker with a content hash + precache list.
import { cpSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src'), dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dist).map((f) => `/${relative(dist, f)}`)
  .filter((f) => f !== '/index.html').filter((f) => !['/sw.js', '/_headers', '/_redirects'].includes(f) && !f.endsWith('.md') && !f.endsWith('.txt'));
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);
const precache = ['/', ...files];
const sw = readFileSync(join(dist, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`built dist/ (${files.length} files, sw ${version})`);
