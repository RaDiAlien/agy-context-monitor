import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'agy-context-monitor';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(__dirname, '..');

function resolvePaths() {
  const targetDir = process.env.AGY_PLUGIN_INSTALL_DIR
    ? resolve(process.env.AGY_PLUGIN_INSTALL_DIR)
    : join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_ID);
  const dataDir = process.env.PLUGIN_DATA
    ? resolve(process.env.PLUGIN_DATA)
    : join(homedir(), '.gemini', 'antigravity', 'plugin_data', PLUGIN_ID);
  return { targetDir, dataDir };
}

function assertSafeTargetOwnership(targetDir) {
  if (!existsSync(targetDir)) return;

  const lst = lstatSync(targetDir);
  if (lst.isSymbolicLink()) {
    throw new Error(`Refusing to modify symlinked plugin directory: ${targetDir}`);
  }
  if (!lst.isDirectory()) {
    throw new Error(`Target plugin path exists and is not a directory: ${targetDir}`);
  }

  const existingManifestPath = join(targetDir, 'plugin.json');
  if (existsSync(existingManifestPath)) {
    const manifest = JSON.parse(readFileSync(existingManifestPath, 'utf8'));
    if (manifest?.name !== PLUGIN_ID) {
      throw new Error(
        `Target directory belongs to a different plugin (${manifest?.name ?? 'unknown'}): ${targetDir}`
      );
    }
  } else {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is non-empty without plugin.json: ${targetDir}`);
    }
  }
}

function install() {
  const { targetDir, dataDir } = resolvePaths();
  const sourceManifest = JSON.parse(readFileSync(join(SOURCE_ROOT, 'plugin.json'), 'utf8'));
  if (sourceManifest?.name !== PLUGIN_ID) {
    throw new Error(`Unexpected source plugin name: ${sourceManifest?.name}`);
  }

  assertSafeTargetOwnership(targetDir);

  const stageDir = `${targetDir}.staging-${process.pid}`;
  if (existsSync(stageDir)) {
    rmSync(stageDir, { recursive: true, force: true });
  }
  mkdirSync(stageDir, { recursive: true });

  try {
    const runtimeFiles = ['plugin.json', 'hooks.json', 'assets', 'hooks', 'sidecars', 'skills'];
    for (const rel of runtimeFiles) {
      const src = join(SOURCE_ROOT, rel);
      if (!existsSync(src)) continue;
      const dst = join(stageDir, rel);
      cpSync(src, dst, { recursive: true });
    }

    const hookRunner = join(stageDir, 'hooks', 'run-hook.sh');
    if (existsSync(hookRunner)) {
      chmodSync(hookRunner, 0o755);
    }

    mkdirSync(dirname(targetDir), { recursive: true });
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    cpSync(stageDir, targetDir, { recursive: true });
    const installedRunner = join(targetDir, 'hooks', 'run-hook.sh');
    if (existsSync(installedRunner)) {
      chmodSync(installedRunner, 0o755);
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }

  console.log(`Installed ${PLUGIN_ID} v${sourceManifest.version}`);
  console.log(`  Plugin dir: ${targetDir}`);
  console.log(`  Data dir:   ${dataDir}`);
  console.log('Note: Antigravity loads new hooks and sidecars cleanly on window reload / restart.');
}

function uninstall({ purgeData = false } = {}) {
  const { targetDir, dataDir } = resolvePaths();
  assertSafeTargetOwnership(targetDir);

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
    console.log(`Removed plugin directory: ${targetDir}`);
  } else {
    console.log(`Plugin not installed at: ${targetDir}`);
  }

  if (purgeData && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    console.log(`Purged plugin data directory: ${dataDir}`);
  }
}

function status() {
  const { targetDir, dataDir } = resolvePaths();
  const installed = existsSync(join(targetDir, 'plugin.json'));
  const installedManifest = installed
    ? JSON.parse(readFileSync(join(targetDir, 'plugin.json'), 'utf8'))
    : null;
  const timingsDir = join(dataDir, 'timings');
  const timingFiles = existsSync(timingsDir)
    ? readdirSync(timingsDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;

  let isSymlink = false;
  try {
    isSymlink = lstatSync(targetDir).isSymbolicLink();
  } catch {
    isSymlink = false;
  }

  const info = {
    pluginId: PLUGIN_ID,
    sourceDir: SOURCE_ROOT,
    targetDir,
    installed,
    isSymlink,
    version: installedManifest?.version ?? null,
    hooksPresent: existsSync(join(targetDir, 'hooks.json')),
    sidecarPresent: existsSync(join(targetDir, 'sidecars', 'dashboard', 'sidecar.json')),
    skillsPresent: existsSync(join(targetDir, 'skills', 'context-monitor', 'SKILL.md')),
    runnerExecutable: existsSync(join(targetDir, 'hooks', 'run-hook.sh'))
      ? (statSync(join(targetDir, 'hooks', 'run-hook.sh')).mode & 0o111) !== 0
      : false,
    dataDir,
    timingFiles,
  };
  console.log(JSON.stringify(info, null, 2));
}

const command = process.argv[2] || 'status';
const purgeFlag = process.argv.includes('--purge-data');

if (command === 'install') {
  install();
} else if (command === 'uninstall') {
  uninstall({ purgeData: purgeFlag });
} else if (command === 'status') {
  status();
} else {
  console.error(`Unknown command: ${command}. Expected: install | uninstall | status`);
  process.exit(1);
}
