import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkJsSyntax, findPython, projectDir, readStdinJson, readVersions } from './_lib.mjs';

const HUE_RE = /(?<![0-9a-f])(d97757|c96442|cc785c|da7756|e08363|f6f1e9|f4f1ea|faf9f5|faf9f7|f1efe8|f4f2ee|1f1e1d|f0efec)(?![0-9a-f])/i;
const NAME_RE = /claude|anthropic/i;
const CLAUDE_RE = /claude/i;
const BRAND_ALLOW = new Map([
  ['plugin/hermes_artifacts/types/design-system/GUIDE.md', 'A system exported from Claude'],
  ['plugin/hermes_artifacts/dsbuild.py', 'one brought over from Claude'],
]);
const SOURCE_ALLOW = new Map([
  ...BRAND_ALLOW,
  ['plugin/hermes_artifacts/store.py', 'A system brought over from Claude'],
  ['tests/test_dsbuild.py', 'def test_a_system_from_claude_comes_up_from_project'],
]);
const VERSION_FILES = new Set([
  'plugin/plugin.yaml',
  'plugin/dashboard/manifest.json',
  'plugin/hermes_artifacts/running.py',
  'plugin/desktop/plugin.js',
]);
const COMMENT_SCAN_EXTS = new Set(['.py', '.js', '.css', '.html', '.md', '.json', '.yaml']);

function hasStrictCommentBranding(root) {
  try {
    const p = path.join(root, 'tests/test_branding.py');
    if (!fs.existsSync(p)) return false;
    return fs.readFileSync(p, 'utf8').includes('test_no_claude_in_comments_either');
  } catch {
    return false;
  }
}

function stripJsComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, '$1');
}

function checkCatalogRule8(rel, text) {
  if (rel !== 'plugin/desktop/plugin.js') return null;
  const stripped = stripJsComments(text);
  if (/\b(?:window|globalThis)\s*(?:\.\s*hermesDesktop\b|\[\s*['"]hermesDesktop['"]\s*\])/.test(stripped)) {
    return 'Catalog rule 8 violation in plugin/desktop/plugin.js: use @hermes/plugin-sdk only (no raw window.hermesDesktop bridge).';
  }
  return null;
}

function checkBranding(root, rel, text) {
  const isPlugin = rel.startsWith('plugin/');
  const isTests = rel.startsWith('tests/');
  const isReadme = rel === 'README.md';
  if (!isPlugin && !isTests && !isReadme) return null;

  const ext = path.posix.extname(rel).toLowerCase();
  const lines = text.split(/\r?\n/);

  if (isPlugin && COMMENT_SCAN_EXTS.has(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HUE_RE);
      if (m) {
        return `Claude palette hex #${m[0]} found at ${rel}:${i + 1}. Keep Hermes theme colors only.`;
      }
    }
  }

  const checkNames =
    isReadme ||
    rel === 'plugin/plugin.yaml' ||
    rel === 'plugin/dashboard/manifest.json' ||
    (isPlugin && ext === '.md');

  if (checkNames) {
    const allowedSubstr = BRAND_ALLOW.get(rel);
    for (let i = 0; i < lines.length; i++) {
      if (NAME_RE.test(lines[i]) && !(allowedSubstr && lines[i].includes(allowedSubstr))) {
        return `Claude/Anthropic branding found at ${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`;
      }
    }
  }

  if (
    (isPlugin || isTests) &&
    COMMENT_SCAN_EXTS.has(ext) &&
    rel !== 'tests/test_branding.py' &&
    hasStrictCommentBranding(root)
  ) {
    const allowedSubstr = SOURCE_ALLOW.get(rel);
    for (let i = 0; i < lines.length; i++) {
      if (CLAUDE_RE.test(lines[i]) && !(allowedSubstr && lines[i].includes(allowedSubstr))) {
        return `Claude mention found in ${rel}:${i + 1} (strict 0.20.0+ comment/source branding rule): ${lines[i].trim().slice(0, 120)}`;
      }
    }
  }

  return null;
}

async function main() {
  try {
    const payload = await readStdinJson();
    const rawPath = payload?.tool_input?.file_path || payload?.tool_input?.path || '';
    if (!rawPath) process.exit(0);

    const root = projectDir();
    const abs = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
    const rel = path.relative(root, abs).split(path.sep).join('/');

    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) process.exit(0);

    const parts = rel.split('/');
    if (
      parts.includes('vendor') ||
      parts.includes('node_modules') ||
      parts.includes('.git') ||
      parts.includes('__pycache__') ||
      rel.startsWith('.claude/worktrees/')
    ) {
      process.exit(0);
    }

    const ext = path.posix.extname(rel).toLowerCase();
    const text = fs.readFileSync(abs, 'utf8');

    if (ext === '.json') {
      try {
        JSON.parse(text);
      } catch (err) {
        process.stderr.write(`[post-edit-check] Invalid JSON in ${rel}: ${err.message}\n`);
        process.exit(2);
      }
    }

    if (ext === '.js' || ext === '.mjs') {
      const js = checkJsSyntax(root, abs);
      if (!js.ok) {
        process.stderr.write(`[post-edit-check] JS syntax error in ${rel}:\n${js.stderr}\n`);
        process.exit(2);
      }
    }

    if (ext === '.py') {
      const py = findPython();
      if (py) {
        const res = spawnSync(
          py.cmd,
          [...py.prefixArgs, '-c', 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])', abs],
          { encoding: 'utf8', timeout: 10000, windowsHide: true }
        );
        if (res.error || res.status !== 0) {
          process.stderr.write(`[post-edit-check] Python syntax error in ${rel}:\n${(res.stderr || res.stdout || res.error?.message || '').trim()}\n`);
          process.exit(2);
        }
      }
    }

    const rule8Err = checkCatalogRule8(rel, text);
    if (rule8Err) {
      process.stderr.write(`[post-edit-check] ${rule8Err}\n`);
      process.exit(2);
    }

    const brandErr = checkBranding(root, rel, text);
    if (brandErr) {
      process.stderr.write(`[post-edit-check] Branding error: ${brandErr}\n`);
      process.exit(2);
    }

    if (VERSION_FILES.has(rel)) {
      const v = readVersions(root);
      if (!v.ok) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `Version parity note: ${v.summary}. Update all 4 version files before finishing (enforced on Stop/TaskCompleted).`,
          },
        }) + '\n');
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
