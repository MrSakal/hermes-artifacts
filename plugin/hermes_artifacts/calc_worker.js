/* The formula runner (types/sheet/calc_runner.js) kept running: calc.py starts this once under node, with the
   same flags, environment and folder as a one-shot runner, and keeps it while it is used.
   argv: <path of calc_runner.js> <path of formula.js> [max output bytes]
   stdin:  one workbook per line, as calc_runner.js reads it (JSON, no raw newline)
   stdout: one answer per line: calc_runner.js's output ({"sheets": [...]}), or {"err": <its exit code>}
   Each line runs calc_runner.js's own code as written (compiled once), with a process of its own whose
   stdin holds that line; nothing else is read or written. */
'use strict';
var fs = require('fs');
var vm = require('vm');
var RUNNER = process.argv[2], FORMULA = process.argv[3], MAX_OUT = process.argv[4] || '';
var run = vm.runInThisContext('(function (require, process, Buffer) {' + fs.readFileSync(RUNNER, 'utf8') + '\n})',
  { filename: RUNNER });

function one(line) {
  var on = {}, out = null;
  var proc = {
    argv: [process.argv[0], RUNNER, FORMULA, MAX_OUT],
    stdin: { on: function (ev, f) { on[ev] = f; } },
    stdout: { write: function (t) { out = String(t); } },
    exitCode: undefined
  };
  run(require, proc, Buffer);
  if (on.data) on.data(Buffer.from(line, 'utf8'));
  if (on.end) on.end();
  if (proc.exitCode) return JSON.stringify({ err: proc.exitCode });
  return out === null ? '{"err":1}' : out;
}

var buf = '', from = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (d) {
  buf += d;
  var i;
  while ((i = buf.indexOf('\n', from)) !== -1) {
    var line = buf.slice(0, i), ans;
    buf = buf.slice(i + 1);
    from = 0;
    try { ans = one(line); } catch (e) { ans = '{"err":2}'; }
    process.stdout.write(ans + '\n');
  }
  from = buf.length;
});
process.stdin.on('end', function () { process.exit(0); });
