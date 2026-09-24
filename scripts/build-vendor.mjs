/**
 * Build script for the local vendor libraries served from `public/vendor/` at
 * `/vendor/*` (a single route prefix for every third-party bundle).
 *
 * - `vendor/htmx.min.js`: copied verbatim from `node_modules`.
 * - `vendor/codemirror.js`: the CodeMirror 6 ESM modules the admin panel needs,
 *   bundled locally so no unpkg request is made (qrcode-generator is
 *   deliberately left on unpkg by the profile share script).
 *
 * Run via `npm run build:vendor` (part of `npm run build`). Rerun after bumping
 * any `@codemirror`/`@lezer` dependency.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'public/vendor');

function copyHtmx() {
  mkdirSync(vendorDir, { recursive: true });
  copyFileSync(
    resolve(root, 'node_modules/htmx.org/dist/htmx.min.js'),
    resolve(vendorDir, 'htmx.min.js'),
  );
  console.log('public/vendor/htmx.min.js');
}

async function buildCodeMirror() {
  const outfile = resolve(vendorDir, 'codemirror.js');
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(root, 'src/vendor/codemirror.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const { size } = statSync(outfile);
  console.log(`public/vendor/codemirror.js  ${(size / 1024).toFixed(1)}kb`);
}

copyHtmx();
await buildCodeMirror();
