// main.ts - DUSKLINE's hand-in program for the make.fun threejs-fps-02
// bounty. It copies the game and its screenshots into the output
// directory and writes the dossier the judges read, using the kit's own
// library so the bytes match the scorer's rebuild exactly. Node 22,
// standard library only; MAKEFUN_OUTPUT_DIR stands in for /output when
// run outside the grader.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repo = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(repo, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(repo, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log('dossier.json: ' + dossier.length + ' bytes -> ' + outDir);
