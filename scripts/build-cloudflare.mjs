import { cp, mkdir, rm } from 'node:fs/promises';
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
  'pdf-import.js',
];

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
for (const file of frontendFiles) {
  await cp(join(projectRoot, file), join(publishDir, file));
}

const pdfjsPackage = join(projectRoot, 'node_modules', 'pdfjs-dist');
const pdfjsVendor = join(publishDir, 'vendor', 'pdfjs');
await mkdir(pdfjsVendor, { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
  await cp(join(pdfjsPackage, 'build', file), join(pdfjsVendor, file));
}
await cp(join(pdfjsPackage, 'LICENSE'), join(pdfjsVendor, 'LICENSE'));
for (const directory of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
  await cp(join(pdfjsPackage, directory), join(pdfjsVendor, directory), { recursive: true });
}

console.log(`Cloudflare static assets prepared in ${publishDir}`);
