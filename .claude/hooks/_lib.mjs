import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

export async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function testPythonCandidate(cmd, prefixArgs = []) {
  try {
    const res = spawnSync(cmd, [...prefixArgs, '-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (!res.error && res.status === 0 && String(res.stdout || '').trim() === '3') {
      return { cmd, prefixArgs };
    }
  } catch {
    // Try next candidate.
  }
  return null;
}

export function findPython() {
  const candidates = [];
  if (process.env.HERMES_TEST_PYTHON) {
    candidates.push([process.env.HERMES_TEST_PYTHON, []]);
  }
  candidates.push(['python3', []], ['python', []], ['py', ['-3']]);

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const localAppData = process.env.LOCALAPPDATA;
    const pyRoot = path.join(localAppData, 'Programs', 'Python');
    try {
      const dirs = fs.readdirSync(pyRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^Python3\d+$/i.test(d.name))
        .map((d) => ({
          name: d.name,
          minor: Number(d.name.replace(/^Python3/i, '')) || 0,
        }))
        .sort((a, b) => b.minor - a.minor);
      for (const dir of dirs) {
        const exe = path.join(pyRoot, dir.name, 'python.exe');
        if (fs.existsSync(exe)) candidates.push([exe, []]);
      }
    } catch {
      // Directory may not exist or may be inaccessible.
    }
    const hermesVenvPy = path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(hermesVenvPy)) {
      candidates.push([hermesVenvPy, []]);
    }
  }

  for (const [cmd, prefixArgs] of candidates) {
    const found = testPythonCandidate(cmd, prefixArgs);
    if (found) return found;
  }
  return null;
}

export function readVersions(root) {
  const specs = [
    {
      rel: 'plugin/plugin.yaml',
      read(text) {
        const m = text.match(/^\s*version:\s*["']?([^\s"']+)["']?/m);
        return m ? m[1] : null;
      },
    },
    {
      rel: 'plugin/dashboard/manifest.json',
      read(text) {
        const data = JSON.parse(text);
        return typeof data?.version === 'string' && data.version ? data.version : null;
      },
    },
    {
      rel: 'plugin/hermes_artifacts/running.py',
      read(text) {
        const m = text.match(/^\s*VERSION\s*=\s*["']([^"']+)["']/m);
        return m ? m[1] : null;
      },
    },
    {
      rel: 'plugin/desktop/plugin.js',
      read(text) {
        const m = text.match(/const\s+PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/);
        return m ? m[1] : null;
      },
    },
  ];

  const versions = {};
  for (const spec of specs) {
    const full = path.join(root, spec.rel);
    try {
      const text = fs.readFileSync(full, 'utf8');
      versions[spec.rel] = spec.read(text);
    } catch {
      versions[spec.rel] = null;
    }
  }

  const values = Object.values(versions);
  const unique = [...new Set(values.filter(Boolean))];
  const ok = values.every((v) => typeof v === 'string' && v.length > 0) && unique.length === 1;
  const summary = specs
    .map((s) => `${s.rel}=${versions[s.rel] ?? '<missing>'}`)
    .join(', ');

  return { versions, ok, uniqueVersion: ok ? unique[0] : null, summary };
}

export function checkJsSyntax(root, absPath) {
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  const isEsm = rel === 'plugin/desktop/plugin.js' || rel.endsWith('.mjs');
  try {
    if (isEsm) {
      const content = fs.readFileSync(absPath, 'utf8');
      const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: content,
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      });
      return {
        ok: !res.error && res.status === 0,
        stderr: (res.stderr || res.error?.message || '').trim(),
      };
    }
    const res = spawnSync(process.execPath, ['--check', absPath], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    return {
      ok: !res.error && res.status === 0,
      stderr: (res.stderr || res.error?.message || '').trim(),
    };
  } catch (err) {
    return { ok: false, stderr: String(err?.message || err) };
  }
}
