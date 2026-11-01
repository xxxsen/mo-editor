import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'dist');
await mkdir(outputDirectory, { recursive: true });
await copyFile(
  path.join(root, 'src-tauri', 'target', 'release', 'mental-omega-editor.exe'),
  path.join(outputDirectory, 'MentalOmegaEditor.exe'),
);
