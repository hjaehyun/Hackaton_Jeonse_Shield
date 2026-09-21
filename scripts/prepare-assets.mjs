// Build-time tooling only. No filesystem / Node APIs enter the Worker bundle.
//
// The browser and the Worker share these modules: the Worker normalizes each
// month, the browser aggregates every month it collected. Copying rather than
// bundling keeps public/ importable as plain ES modules with no build step of
// its own.
import { copyFile, mkdir } from 'node:fs/promises';

const SHARED = ['ratio.js', 'rtms.js', 'aggregate.js', 'months.js'];

await mkdir(new URL('../public/lib/', import.meta.url), { recursive: true });

await Promise.all(SHARED.map((name) => copyFile(
  new URL(`../src/lib/${name}`, import.meta.url),
  new URL(`../public/lib/${name}`, import.meta.url),
)));
