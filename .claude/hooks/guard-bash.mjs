import { readStdinJson } from './_lib.mjs';

function splitShellSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (ch === '\\' && i + 1 < command.length) {
        current += ch + next;
        i += 2;
        continue;
      }
      current += ch;
      if (ch === '"') quote = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }

    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i += 2;
      continue;
    }

    if (ch === ';' || ch === '|' || ch === '\n' || ch === '\r') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function stripGitMessages(segment) {
  if (!/^\s*git(?:\s+-C\s+\S+)?\s+(?:commit|tag)\b/i.test(segment)) {
    return segment;
  }
  return segment.replace(
    /(^|\s)(?:-m|--message)(?:=|\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
    '$1-m ""'
  );
}

function block(reason, alternative) {
  process.stderr.write(`[guard-bash] Blocked: ${reason}\nSafe alternative: ${alternative}\n`);
  process.exit(2);
}

function hasStagingHermesHome(raw) {
  return /(?:^|\s|;|\$env:)HERMES_HOME\s*=\s*["']?[^"'\s;]*(?:staging|hermes-staging|temp|tmp)/i.test(raw);
}

function isStagingScript(seg) {
  return /(?:^|[\s"'`])(?:\.[\\/])?tools[\\/]staging[\\/][A-Za-z0-9_.-]+\.ps1\b/i.test(seg);
}

function isHermesVenvPythonReadOnly(seg) {
  const hasVenvPy = /hermes-agent[\\/]venv[\\/]Scripts[\\/]python(?:\.exe)?\b/i.test(seg);
  if (!hasVenvPy) return false;
  const mutates = /(?:^|\s)(?:rm|rmdir|del|erase|Remove-Item|ri|mv|Move-Item|cp|Copy-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|mkdir|touch)\b|>{1,2}/i.test(seg);
  return !mutates;
}

function checkSegment(seg, allStagingEnv, hasPipeRceContext) {
  const clean = stripGitMessages(seg);

  // 1. Secret / credential file reads via shell
  const readVerbMatch = clean.match(
    /^\s*(?:sudo\s+|env\s+)?(?:cat|type|head|tail|less|more|sed|awk|grep|rg|Get-Content|gc)\b/i
  );
  if (readVerbMatch) {
    if (/(?:^|[\s"'=/\\])\.env(?:\.(?!example\b|sample\b|template\b)[A-Za-z0-9_.-]+)?(?=$|[\s"';])/i.test(clean)) {
      block('Reading .env / secret environment files via shell is disallowed.', 'Use .env.example or ask the user for needed configuration.');
    }
    if (/(?:~|\$HOME|\$env:USERPROFILE|%USERPROFILE%)[\\/]\.(?:ssh|aws|gnupg|config[\\/]gh)\b/i.test(clean)) {
      block('Reading user credential/key directories (~/.ssh, ~/.aws, ~/.gnupg, ~/.config/gh) is disallowed.', 'Keep operations inside the workspace.');
    }
    if (/(?:~[\\/]\.hermes|\$HOME[\\/]\.hermes|%LOCALAPPDATA%[\\/]hermes|\$env:LOCALAPPDATA[\\/]hermes|AppData[\\/]Local[\\/]hermes)[\\/]+(?:\.env|auth\.json)\b/i.test(clean)) {
      block('Reading live Hermes credentials (.env / auth.json) is disallowed.', 'Use tools/staging/ for isolated testing.');
    }
  }

  // 2. Live Hermes home & gateway protection
  const touchesLiveHermesPath = /(?:~[\\/]\.hermes|\$HOME[\\/]\.hermes|%LOCALAPPDATA%[\\/]hermes|\$env:LOCALAPPDATA[\\/]hermes|AppData[\\/]Local[\\/]hermes)(?=[\\/\s"']|$)/i.test(clean);
  if (touchesLiveHermesPath && !/hermes-staging/i.test(clean)) {
    if (!isStagingScript(clean) && !isHermesVenvPythonReadOnly(clean)) {
      const mutatesLive = /(?:^|\s)(?:rm|rmdir|del|erase|Remove-Item|ri|mv|Move-Item|cp|Copy-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|ni|mkdir|touch|chmod|chown|ln|mklink|tee)\b|\bsed\s+-i\b|>{1,2}/i.test(clean);
      if (mutatesLive) {
        block('Mutating the live Hermes home directory is disallowed.', 'Use tools/staging/ scripts against C:\\Sajat\\hermes-staging.');
      }
    }
  }

  // Bare catalog name install (always disallowed even in staging)
  if (/\bhermes(?:\.exe)?\s+plugins\s+install\s+hermes-artifacts(?:\s|$)/i.test(clean)) {
    block('Installing by bare catalog name "hermes-artifacts" installs a pinned old release.', 'Use MrSakal/hermes-artifacts/plugin or .\\tools\\staging\\install.ps1 -Local -Sha <sha>.');
  }

  // Bare hermes gateway stop/restart
  if (/\bhermes(?:\.exe)?\s+gateway\s+(?:stop|restart)\b/i.test(clean)) {
    if (!isStagingScript(clean) && !allStagingEnv) {
      block('Running bare "hermes gateway stop/restart" affects the live gateway process.', 'Use .\\tools\\staging\\stop.ps1 / start.ps1 or set HERMES_HOME to a staging/temp directory.');
    }
  }

  // Bare hermes plugins install/remove/update/disable/enable or config set
  if (/\bhermes(?:\.exe)?\s+(?:plugins\s+(?:install|remove|update|disable|enable)|config\s+set)\b/i.test(clean)) {
    if (!isStagingScript(clean) && !allStagingEnv) {
      block('Mutating live Hermes plugins or config is disallowed.', 'Use .\\tools\\staging\\install.ps1 or .\\tools\\staging\\hermes.ps1 for staging.');
    }
  }

  // 3. Irreversible git / filesystem / RCE commands
  if (/^\s*git\b/i.test(clean)) {
    if (/\bpush\b/i.test(clean)) {
      if (/(?:^|\s)(?:--force(?=\s|$)|-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))/.test(clean)) {
        block('Force-pushing (git push --force / -f) is blocked.', 'Use git push --force-with-lease on feature branches if truly needed and approved.');
      }
      if (/(?:^|\s|:|refs\/heads\/)(?:main|master)(?=\s|$)/.test(clean)) {
        block('Direct push to main/master is blocked.', 'Push to a feature branch and open a pull request.');
      }
    }
    if (/\breset\b/i.test(clean) && /(?:^|\s)--hard(?=\s|$)/.test(clean)) {
      block('git reset --hard discards uncommitted work irreversibly.', 'Use git stash or restore specific files with git restore <path>.');
    }
    if (/\bclean\b/i.test(clean) && /(?:^|\s)(?:--force(?=\s|$)|-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))/.test(clean)) {
      block('git clean -f removes untracked files irreversibly.', 'Inspect with git clean -n first or remove specific paths explicitly.');
    }
  }

  // Catastrophic deletes
  if (/^\s*(?:sudo\s+)?rm\b/i.test(clean)) {
    const hasRecForce = /(?:^|\s)(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)(?=\s|$)|(?:--recursive\b.*--force\b|--force\b.*--recursive\b)/i.test(clean);
    if (hasRecForce && /(?:^|\s)(?:\/\*?|~(?:\/\*?)?|\$HOME(?:\/\*?)?|\.git\/?|[A-Za-z]:\\)(?=\s|$|["'])/.test(clean)) {
      block('Catastrophic recursive forced deletion targeting root, home, or .git is blocked.', 'Target only a specific temporary/build path.');
    }
  }
  if (/^\s*(?:Remove-Item|ri|del|rd)\b/i.test(clean)) {
    if (/(?:^|\s|["'\\/])(?:\.git|[A-Za-z]:\\|\/|\$HOME|\$env:USERPROFILE)(?=$|\s|["'\\/])/i.test(clean)) {
      block('Destructive deletion targeting .git, drive root, or user home is blocked.', 'Target only a specific disposable folder.');
    }
  }

  // PowerShell download-and-execute in one segment
  if (/\b(?:iex|Invoke-Expression)\b[^\n;]*\b(?:iwr|Invoke-WebRequest|irm|Invoke-RestMethod|DownloadString)\b/i.test(clean)) {
    block('Downloading and executing remote code via Invoke-Expression is blocked.', 'Download and inspect scripts before executing.');
  }

  if (hasPipeRceContext) {
    block('Piping remote curl/wget/Invoke-WebRequest output directly into a shell is blocked.', 'Download the script to a file and inspect it before running.');
  }
}

async function main() {
  try {
    const payload = await readStdinJson();
    const raw = String(payload?.tool_input?.command ?? '');
    if (!raw.trim()) process.exit(0);

    const allStagingEnv = hasStagingHermesHome(raw);
    const segments = splitShellSegments(raw);

    // Check pipe-to-shell across the raw command (ignoring git commit messages)
    const cleanWhole = segments.map(stripGitMessages).join(' ; ');
    const pipeRce =
      /(?:curl|wget)\b[^|\n]*\|\s*(?:env\s+)?(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|pwsh|powershell)\b/i.test(raw) ||
      /\b(?:iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^|\n]*\|\s*(?:iex|Invoke-Expression)\b/i.test(cleanWhole);

    for (const seg of segments) {
      checkSegment(seg, allStagingEnv, pipeRce);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
