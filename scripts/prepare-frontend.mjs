import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const distDir = path.join(projectRoot, 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

for (const entry of ['index.html', 'js']) {
  cpSync(path.join(projectRoot, entry), path.join(distDir, entry), { recursive: true });
}

const iconsDir = path.join(projectRoot, 'src-tauri', 'icons');
if (existsSync(iconsDir)) {
  cpSync(iconsDir, path.join(distDir, 'icons'), { recursive: true });
}

console.log(`[prepare-frontend] Copied web assets to ${distDir}`);
