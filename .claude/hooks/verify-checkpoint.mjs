import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkJsSyntax, findPython, projectDir, readStdinJson, readVersions } from './_lib.mjs';

function getRelevantChanges(root) {
  const res = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (res.error || res.status !== 0) return { gitOk: false, files: [] };

  const files = [];
  const lines = String(res.stdout || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    p = p.replace(/\\/g, '/');
    if (
      p.startsWith('plugin/') ||
      p.startsWith('tests/') ||
      p.startsWith('examples/') ||
      p === 'README.md'
    ) {
      files.push(p);
    }
  }
  return { gitOk: true, files };
}

function collectFastTestModules(root, files) {
  const base = ['tests.test_branding', 'tests.test_running'];
  const baseSet = new Set(base);
  const extras = [];
  const extraSet = new Set();

  function maybeAdd(relTestFile, modName) {
    if (baseSet.has(modName) || extraSet.has(modName) || extras.length >= 6) return;
    if (fs.existsSync(path.join(root, relTestFile))) {
      extraSet.add(modName);
      extras.push(modName);
    }
  }

  for (const f of files) {
    let m = f.match(/^tests\/(test_[A-Za-z0-9_]+)\.py$/);
    if (m) {
      maybeAdd(`tests/${m[1]}.py`, `tests.${m[1]}`);
      continue;
    }
    m = f.match(/^plugin\/hermes_artifacts\/([A-Za-z0-9_]+)\.py$/);
    if (m) {
      maybeAdd(`tests/test_${m[1]}.py`, `tests.test_${m[1]}`);
      continue;
    }
    if (f === 'plugin/desktop/plugin.js') {
      maybeAdd('tests/test_desktop_plugin.py', 'tests.test_desktop_plugin');
      maybeAdd('tests/test_desktop_states.py', 'tests.test_desktop_states');
      continue;
    }
    if (f === 'plugin/dashboard/plugin_api.py') {
      maybeAdd('tests/test_viewer_api.py', 'tests.test_viewer_api');
      continue;
    }
    if (f === 'plugin/hermes_artifacts/calc_worker.js') {
      maybeAdd('tests/test_calc_worker.py', 'tests.test_calc_worker');
      continue;
    }
    if (f.startsWith('plugin/hermes_artifacts/types/')) {
      maybeAdd('tests/test_hermes_look.py', 'tests.test_hermes_look');
      m = f.match(/^plugin\/hermes_artifacts\/types\/([a-z0-9_-]+)\//);
      if (m) {
        const norm = m[1].replace(/-/g, '_');
        maybeAdd(`tests/test_${norm}.py`, `tests.test_${norm}`);
        maybeAdd(`tests/test_${norm}s.py`, `tests.test_${norm}s`);
      }
    }
  }

  return [...base, ...extras];
}

function collectCiJsFiles(root) {
  const files = [
    path.join(root, 'plugin/desktop/plugin.js'),
    path.join(root, 'plugin/hermes_artifacts/assets/bridge.js'),
    path.join(root, 'plugin/hermes_artifacts/assets/shell.js'),
    path.join(root, 'plugin/hermes_artifacts/types/_kit/kit.js'),
  ];

  for (const extraRel of ['plugin/dashboard/dist/index.js', 'plugin/hermes_artifacts/calc_worker.js']) {
    const extraAbs = path.join(root, extraRel);
    if (fs.existsSync(extraAbs)) {
      files.push(extraAbs);
    }
  }

  const typesDir = path.join(root, 'plugin/hermes_artifacts/types');
  if (fs.existsSync(typesDir)) {
    for (const entry of fs.readdirSync(typesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name === 'vendor' || entry.name === '_kit') continue;
      const subdir = path.join(typesDir, entry.name);
      for (const f of fs.readdirSync(subdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (f.isFile() && f.name.endsWith('.js')) {
          files.push(path.join(subdir, f.name));
        }
      }
    }
  }
  return files;
}

async function main() {
  const runAll = process.argv.includes('--all');
  const fastMode = process.argv.includes('--fast');
  const withBrowser = process.argv.includes('--with-browser');
  const root = projectDir();
  const changes = getRelevantChanges(root);

  if (!runAll) {
    const payload = await readStdinJson();
    if (payload?.stop_hook_active === true) {
      process.exit(0);
    }
    if (changes.gitOk && changes.files.length === 0) {
      process.exit(0);
    }
  }

  const failures = [];

  // 1. 4-way version parity
  const ver = readVersions(root);
  if (!ver.ok) {
    failures.push(`1. Version parity mismatch across the 4 version files:\n   ${ver.summary}`);
  }

  // 2. CI JS syntax checks
  const jsFiles = collectCiJsFiles(root);
  for (const abs of jsFiles) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!fs.existsSync(abs)) {
      failures.push(`2. Expected JS file missing: ${rel}`);
      continue;
    }
    const res = checkJsSyntax(root, abs);
    if (!res.ok) {
      failures.push(`2. JS syntax check failed in ${rel}:\n   ${res.stderr}`);
    }
  }

  // 3. Python unit test suite
  const py = findPython();
  let fastModules = [];
  if (py) {
    const timeoutMs = fastMode ? 90000 : 540000;
    fastModules = fastMode ? collectFastTestModules(root, changes.files) : [];
    const pyArgs = fastMode
      ? [...py.prefixArgs, '-m', 'unittest', ...fastModules]
      : [...py.prefixArgs, '-m', 'unittest', 'discover', '-s', 'tests'];

    const childEnv = { ...process.env };
    if (withBrowser) {
      delete childEnv.HA_NO_BROWSER;
    } else {
      childEnv.HA_NO_BROWSER = '1';
    }

    const res = spawnSync(py.cmd, pyArgs, {
      cwd: root,
      env: childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (res.error || res.status !== 0) {
      const timedOut = res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM' || res.signal === 'SIGKILL';
      const combined = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
      const lines = combined.split(/\r?\n/);
      let tail = lines.slice(-60).join('\n');
      if (tail.length > 4000) tail = tail.slice(-4000);
      const timeoutNote = timedOut ? ` (timed out after ${timeoutMs / 1000}s)` : '';
      failures.push(`3. Unit tests failed (${py.cmd})${timeoutNote}:\n${tail || res.error?.message || 'non-zero exit'}`);
    }
  } else {
    process.stderr.write('[verify-checkpoint] Warning: no Python 3 executable found; skipped unittest suite.\n');
  }

  if (failures.length > 0) {
    process.stderr.write(`[verify-checkpoint] Verification failed:\n\n${failures.join('\n\n')}\n`);
    process.exit(2);
  }

  if (runAll) {
    const modeLabel = fastMode ? 'fast' : 'full';
    const browserLabel = withBrowser ? 'on' : 'off';
    const unitLabel = py ? (fastMode ? `passed (${fastModules.length} module(s))` : 'passed') : 'skipped-no-python';
    process.stdout.write(
      `[verify-checkpoint] OK (mode=${modeLabel}, browser=${browserLabel}, versions=${ver.uniqueVersion}, jsFiles=${jsFiles.length}, unittest=${unitLabel})\n`
    );
  }
  process.exit(0);
}

main();
