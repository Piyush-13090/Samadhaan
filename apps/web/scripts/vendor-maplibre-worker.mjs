/**
 * Copies MapLibre's web worker into `public/vendor/maplibre/`.
 *
 * MapLibre loads its worker with `new URL(<computed name>, import.meta.url)`.
 * The name is computed at runtime, so the bundler cannot see it, and once
 * MapLibre is bundled into a Next chunk that URL points at a file that does not
 * exist — the map then fails with "Worker failed to load". The supported fix is
 * `setWorkerUrl()` with a URL that serves the worker; this script provides that
 * file.
 *
 * The worker is an ES module importing `./maplibre-gl-shared.mjs`, so both are
 * copied side by side. Run before `dev` and `build`, from whatever version is
 * installed, so the worker can never drift from the main bundle. The output is
 * git-ignored — it is a build artifact.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const source = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const target = join(here, '..', 'public', 'vendor', 'maplibre');

mkdirSync(target, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(source, file), join(target, file));
}

const { version } = require('maplibre-gl/package.json');
console.log(`maplibre-gl ${version}: worker copied to public/vendor/maplibre`);
