import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publishDir = join(projectRoot, 'dist');
const frontendFiles = [
  'index.html',
  'auth.html',
  'dashboard.html',
  'style.css',
  'app.js',
  'auth.js',
  'api-config.js',
];
const defaultApiOrigin = 'https://bunkbudget-api-divine-grass-66506262.onrender.com';
const apiOrigin = (process.env.BUNKBUDGET_API_URL || defaultApiOrigin).replace(/\/+$/, '');

let parsedApiOrigin;
try {
  parsedApiOrigin = new URL(apiOrigin);
} catch {
  throw new Error('BUNKBUDGET_API_URL must be a valid absolute API origin.');
}
if (!['https:', 'http:'].includes(parsedApiOrigin.protocol)) {
  throw new Error('BUNKBUDGET_API_URL must use HTTPS (HTTP is allowed for local development).');
}

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
for (const file of frontendFiles) {
  await cp(join(projectRoot, file), join(publishDir, file));
}
await writeFile(
  join(publishDir, '_redirects'),
  `/api/* ${apiOrigin}/api/:splat 200\n`,
  'utf8',
);

console.log(`Netlify site files created in ${publishDir}`);
