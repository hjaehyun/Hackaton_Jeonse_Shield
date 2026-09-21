// Build-time tooling only. No filesystem / Node APIs enter the Worker bundle.
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../public/lib/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/lib/ratio.js', import.meta.url), new URL('../public/lib/ratio.js', import.meta.url));
