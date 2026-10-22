import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildStructuredExportPackage } from '../src/stores/storeExportPackage';
import { convertKelivoBackupToStructuredExportSnapshot } from '../src/stores/kelivoImportAdapter';

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] ?? '';
}

function buildDefaultOutputPath(inputPath: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const basename = inputPath.split(/[\\/]/).pop()?.replace(/\.(?:zip|db|sqlite|sqlite3)$/i, '') || 'kelivo-backup';
  return resolve(process.cwd(), 'exports', `${basename}-polaris-import-${timestamp}.zip`);
}

async function main() {
  const input = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
  if (!input) {
    throw new Error('用法：npx tsx tools/kelivo-to-polaris-import.ts <kelivo-backup.zip|kelivo.db> --out <polaris-import.zip>');
  }

  const inputPath = resolve(process.cwd(), input);
  const outputPath = resolve(process.cwd(), readArg('--out') || buildDefaultOutputPath(inputPath));
  const source = await readFile(inputPath);
  const { snapshot, stats } = await convertKelivoBackupToStructuredExportSnapshot(
    new Blob([source])
  );
  const exported = await buildStructuredExportPackage(snapshot);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, new Uint8Array(await exported.blob.arrayBuffer()));

  console.log(JSON.stringify({
    outputPath,
    stats
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
