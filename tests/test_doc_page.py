"""The doc page while the person types and Hermes edits the same doc (types/doc/doc.js).

Invariants, for a remote change (Hermes' ha_live_edit) arriving while the person types in a block:
  (a) no key the person typed is dropped or reordered because another block changed;
  (b) the caret, the selection and the focus stay where the person has them;
  (c) the window does not jump: the block being typed in keeps its place on screen when blocks above it
      change, come or go;
  (d) a change to another block shows without waiting for the person to stop typing;
  (e) a change to the block being typed in never silently replaces words not saved yet: they win there
      until the person pauses, then the save meets Hermes' change as a conflict and the person's words stay
      as a suggestion on Hermes' text (a block Hermes removed comes back as a new block with them);
  (f) text is never dropped because a save failed or was slow: a block's words count as unsaved until the
      server took them (an error, no answer, a timeout are failures), stay on screen through any read, and
      are sent again (at the next pause, or by a retry that backs off); if even keeping them as a suggestion
      and as a new block fails, they stay in the block, unsaved, and the page says so;
  (g) a late read never rolls a block back: a read older than what the page already saw (the newest read
      merged, or the rev of its own save) is not merged;
  (h) typing continues through a conflict and through a move: after a conflict the block keeps the focus
      and the person's words, and what they type on goes to their suggestion on Hermes' text (it shows as
      such once they leave the block); Hermes moving the block is no conflict at all (docs.py);
  (i) a structural edit is all or nothing and survives a failed save: a split (Enter in a paragraph, leaving
      a list, lifting a list's first item, a divider), a merge (Backspace), a new, removed or moved block, a
      paste of several paragraphs, goes out as ONE edit that the server applies whole or not at all, stays in
      the page's outbox until the server answers it, is sent again after a failure, and is played over every
      read meanwhile (an edit refused because Hermes removed a block it names is made to fit and sent);
  (j) a retried edit is applied once: each edit carries a client id (cid), the same when sent again; the
      server answers a cid it has applied with its first answer, and a read lists the latest applied cids so
      the page settles one whose answer it lost without showing its blocks twice;
  (k) nothing typed is lost when the page is hidden or unloaded while a save is pending or debounced, as far
      as the page can see to it: on pagehide and on visibilitychange to hidden it saves what waits for a
      pause and sends every edit in the outbox at once; beforeunload warns while anything is unsent;
  (l) edits from one page are applied in the order they were made, however they are sent: the pump sends
      one at a time; a flush sends the whole outbox (the one in flight included) as ONE ordered batch that
      the server applies in order under the doc's lock (docs.apply_batch); and the server never applies a
      page's text op on a block over a later one of that page that already landed (docs._seq).
  An IME composition is never touched.

The first root cause was the page drawing the whole doc again on each read (page.replaceChildren): the block
being typed in was taken out of the page and put back, which drops its focus, caret, composition and undo,
so the keys typed next went nowhere. Here: the page's pure helpers run under node (placeBlocks, which moves
blocks around the one being typed in and never takes it out; onRead, what a read does to that block;
mergeBlocks, which keeps unsaved words through a read; saveOutcome, what counts as saved; staleRead;
replayOps, the outbox played over a read; repairOps, an edit made to fit a doc Hermes changed), and the
rest of the behaviour, plain to see in the source, stays so. The browser runs that measured it are in the
fixes' reports (first: 142 of 220 typed keys lost, the focus, the caret, undo, a 369 px jump; then: a failed
save's words wiped by the next read, 80 of 120 keys lost after a conflict, a late read losing a word; then:
the text after the caret lost when an Enter's new block failed to save, a failed paste lost, a retried new
block made twice, a pending save lost when the page went away)."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "plugin" / "hermes_artifacts" / "types" / "doc"
PAGE = DOC / "doc.js"
NODE = shutil.which("node")

SCRIPT = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const a = src.indexOf('// >>> pure'), b = src.indexOf('// <<< pure');
if (a < 0 || b < a) throw new Error('the pure block is not marked in doc.js');
const P = new Function(src.slice(a, b) + '\nreturn PURE;')();
const out = {};
function group(name, cases, run) {
  const fails = [];
  cases.forEach((c) => {
    let got;
    try { got = run(c); } catch (e) { got = 'THROW ' + (e && e.stack || e); }
    const want = c[c.length - 1];
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push([JSON.stringify(c.slice(0, -1)), JSON.stringify(got), JSON.stringify(want)]);
  });
  out[name] = { n: cases.length, fails };
}

// A parent node as the DOM has it: a node put in again is first taken out. Every call is counted, and
// one that takes the kept node out is recorded.
function Parent(names) {
  const p = { kids: [], ops: 0, touched: [] };
  const link = () => p.kids.forEach((k, i) => { k.parentNode = p; k.nextSibling = p.kids[i + 1] || null; });
  p.removeChild = (n) => { p.ops++; if (n.kept) p.touched.push('remove'); const i = p.kids.indexOf(n); if (i < 0) throw new Error('not a child'); p.kids.splice(i, 1); n.parentNode = n.nextSibling = null; link(); return n; };
  p.insertBefore = (n, ref) => {
    p.ops++; if (n.kept) p.touched.push('insert');
    if (ref && ref.parentNode !== p) throw new Error('ref is not a child');
    const j = p.kids.indexOf(n); if (j >= 0) p.kids.splice(j, 1);
    p.kids.splice(ref ? p.kids.indexOf(ref) : p.kids.length, 0, n); link(); return n;
  };
  Object.defineProperty(p, 'firstChild', { get: () => p.kids[0] || null });
  p.kids = names.map((x) => ({ name: x })); link();
  return p;
}
// [the page's blocks, the blocks after the read (a new name is a new node), the one being typed in,
//  [the page after, calls that took the kept node out, DOM calls in all]]
function run(cur, want, keepName) {
  const p = Parent(cur), have = {};
  p.kids.forEach((k) => { have[k.name] = k; if (k.name === keepName) k.kept = true; });
  const nodes = want.map((x) => have[x] || { name: x });
  P.placeBlocks(p, nodes, have[keepName] || null);
  return [p.kids.map((k) => k.name).join(' '), p.touched.length, p.ops];
}
group('placeBlocks', [
  [['a', 'b', 'K', 'c'], ['a', 'b', 'K', 'c'], 'K', ['a b K c', 0, 0]],                // nothing changed: nothing moves
  [['a', 'b', 'K', 'c'], ['a', 'x', 'y', 'b', 'K', 'c'], 'K', ['a x y b K c', 0, 2]],   // Hermes inserts above
  [['a', 'b', 'K', 'c'], ['a', 'K', 'c'], 'K', ['a K c', 0, 1]],                        // removes a block above
  [['a', 'b', 'K', 'c'], ['a', 'b', 'K', 'c', 'z'], 'K', ['a b K c z', 0, 1]],          // inserts below
  [['a', 'b', 'K', 'c'], ['a', 'K', 'c', 'b'], 'K', ['a K c b', 0, 1]],                 // moves one from above to below
  [['a', 'K', 'c', 'd'], ['d', 'a', 'K', 'c'], 'K', ['d a K c', 0, 1]],                 // and from below to above
  [['K', 'a'], ['x', 'K', 'a'], 'K', ['x K a', 0, 1]],                                  // the kept one is first
  [['a', 'K'], ['a', 'K', 'x'], 'K', ['a K x', 0, 1]],                                  // and last
  [['a', 'b', 'K', 'c', 'd'], ['d', 'c', 'K', 'b', 'a'], 'K', ['d c K b a', 0, 4]],     // everything around it turned round
  [['a', 'b', 'c'], ['c', 'a', 'x'], null, ['c a x', 0, 3]],                           // no block typed in
  [['a', 'K', 'b'], ['a', 'b'], 'K', ['a b', 1, 1]],                                    // the kept one gone too: out it goes
  [[], ['a', 'b'], null, ['a b', 0, 2]],
], (c) => run(c[0], c[1], c[2]));

// Many random reads: blocks come, go and move around the one being typed in, which never leaves the page.
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const fuzz = [];
for (let t = 0; t < 400; t++) {
  const cur = []; for (let i = 0, n = 1 + rnd(12); i < n; i++) cur.push('b' + i);
  const keep = cur[rnd(cur.length)];
  const want = cur.filter((x) => x === keep || rnd(5)); // some go
  for (let i = 0, n = rnd(4); i < n; i++) want.splice(rnd(want.length + 1), 0, 'n' + t + '_' + i); // some come
  for (let i = want.length - 1; i > 0; i--) if (rnd(3) === 0) { const j = rnd(i + 1); [want[i], want[j]] = [want[j], want[i]]; } // some move
  const got = run(cur, want, keep);
  if (got[0] !== want.join(' ') || got[1] !== 0) fuzz.push([cur.join(' '), want.join(' '), keep, got]);
}
out.fuzz = { n: 400, fails: fuzz.slice(0, 5) };

// [the server still has it, its text there is this page's, words typed here not saved yet, what the read does]
group('onRead', [
  [true, true, false, 'keep'], [true, true, true, 'keep'],
  [true, false, true, 'keep'],      // Hermes changed it while the person types: their words stay; the save meets it
  [true, false, false, 'redraw'],   // nothing waits to be saved there: Hermes' text, the caret kept
  [false, false, true, 'readd'],    // Hermes removed it while the person types: kept, saved again as a new block
  [false, false, false, 'drop'], [false, true, false, 'drop'], [false, true, true, 'readd'],
], (c) => P.onRead(c[0], c[1], c[2]));

// (f) (g) [the server's blocks, the page's blocks before the read, words here not saved yet, the blocks after]
const B = (s) => s.split(' ').filter(Boolean).map((x) => { const [id, md] = x.split('='); return { id, md: md || id }; });
const show = (m) => m.blocks.map((b) => b.id + '=' + b.md).join(' ') + (m.back.length ? ' | back ' + m.back.map((x) => x.id + '>' + x.after).join(',') : '');
group('mergeBlocks', [
  [B('a b c'), B('a b c'), {}, 'a=a b=b c=c'],
  [B('a b=Hermes c'), B('a b c'), {}, 'a=a b=Hermes c=c'],                                // a read shows Hermes' words
  [B('a b=old c'), B('a b=mine c'), { b: 'mine' }, 'a=a b=mine c=c'],                    // a failed or slow save: the words stay
  [B('x a b=old c'), B('a b=mine c'), { b: 'mine' }, 'x=x a=a b=mine c=c'],               // and other blocks change around it
  [B('a c'), B('a b=mine c'), { b: 'mine' }, 'a=a b=mine c=c | back b>a'],               // gone there: kept where it was
  [B('c'), B('a b=mine c'), { b: 'mine' }, 'b=mine c=c | back b>null'],                  // nothing before it left
  [B('c'), B('a=m1 b=m2 c'), { a: 'm1', b: 'm2' }, 'a=m1 b=m2 c=c | back a>null,b>a'],   // two in a row keep their order
  [B('b a c'), B('a b=mine c'), { b: 'mine' }, 'b=mine a=a c=c'],                        // moved there: its place, its words
], (c) => show(P.mergeBlocks(c[0], c[1], c[2])));
// (f) [a save's answer, what it is]
group('saveOutcome', [
  [{ ok: true, rev: 5 }, 'ok'], [{ ok: false, conflict: true, blocks: ['b'] }, 'conflict'], [undefined, 'failed'], [null, 'failed'],
  [{ ok: false, rev: 5 }, 'failed'], [{ detail: 'injected failure' }, 'failed'], [{}, 'failed'],
], (c) => P.saveOutcome(c[0]));
// (g) [the read's rev, the newest rev merged, the rev of the page's own last save, is it stale]
group('staleRead', [
  [5, 5, 0, false], [6, 5, 0, false], [4, 5, 0, true], [5, 3, 6, true], [6, 3, 6, false], [1, 0, undefined, false],
], (c) => P.staleRead(c[0], c[1], c[2]));

// (i) [the server's blocks, the outbox, ids the server gave, the blocks shown]
const E = (via, ...ops) => ({ via, ops });
group('replayOps', [
  [B('a b c'), [], {}, 'a=a b=b c=c'],
  [B('a b c'), [E('edit', { op: 'replace', block: 'b', md: 'head' }, { op: 'insert', after: 'b', md: 'tail', tmp: 't1', _aprevs: ['b', 'a'] })], {}, 'a=a b=head t1=tail c=c'], // a split not answered yet
  [B('a b=head t9=tail c'), [E('edit', { op: 'insert', after: 'b', md: 'tail', tmp: 't1' })], { t1: 't9' }, 'a=a b=head t9=tail c=c'],   // it landed: never twice
  [B('a c'), [E('edit', { op: 'insert', after: 'b', md: 'new', tmp: 't1', _aprevs: ['b', 'a'] })], {}, 'a=a t1=new c=c'],              // its anchor gone: after the block before it
  [B('a c'), [E('edit', { op: 'replace', block: 'b', md: 'mine', _prevs: ['a'] })], {}, 'a=a b=mine c=c'],                          // words for a block Hermes removed stay where it was
  [B('a b c'), [E('edit', { op: 'replace', block: 'a', md: 'ab' }, { op: 'delete', block: 'b' })], {}, 'a=ab c=c'],                 // a merge
  [B('a b c'), [E('edit', { op: 'move', block: 'c', after: null, _aprevs: [] })], {}, 'c=c a=a b=b'],
  [B('a b c'), [E('edit', { op: 'insert', after: null, md: 'p1\n\np2', tmp: 't1' })], {}, 't1=p1\n\np2 a=a b=b c=c'],             // a paste of paragraphs, before the server splits it
  [B('a b c'), [E('suggest', { op: 'replace', block: 'b', md: 'x' })], {}, 'a=a b=b c=c'],                                          // a proposal changes no block
  [B('a b c'), [E('edit', { op: 'insert', after: 'b', md: 'n', tmp: 't1' }), E('edit', { op: 'replace', block: 't1', md: 'n2' })], {}, 'a=a b=b t1=n2 c=c'],
], (c) => P.replayOps(c[0], c[1], c[2]).map((b) => b.id + '=' + b.md).join(' '));
// (i) [an edit the server refused, its blocks now, what is sent instead]
const fix = (r) => r === null ? null : r.via + (r.gone ? ' gone' : '') + ': ' + r.ops.map((o) => o.op + ':' + (o.block || '') + '>' + (o.after === undefined ? '' : o.after) + (o.tmp ? '#' + o.tmp : '')).join(' ');
group('repairOps', [
  [{ via: 'edit', ops: [{ op: 'replace', block: 'b', md: 'mine', _prevs: ['a'] }] }, ['a', 'c'], 'edit gone: insert:>a#b'],
  [{ via: 'edit', ops: [{ op: 'replace', block: 'b', md: 'h', _prevs: ['a'] }, { op: 'insert', after: 'b', md: 't', tmp: 't1', _aprevs: ['b', 'a'] }] }, ['a', 'c'], 'edit gone: insert:>a#b insert:>b#t1'],
  [{ via: 'edit', ops: [{ op: 'delete', block: 'b' }] }, ['a'], 'edit: '],
  [{ via: 'edit', ops: [{ op: 'insert', after: 'x', md: 'n', tmp: 't1', _aprevs: ['x', 'y', 'a'] }] }, ['a', 'c'], 'edit: insert:>a#t1'],
  [{ via: 'edit', ops: [{ op: 'move', block: 'c', after: 'x', _aprevs: ['x'] }] }, ['a', 'c'], 'edit: move:c>null'],
  [{ via: 'suggest', asBlock: true, ops: [{ op: 'replace', block: 'b', md: 'mine', _prevs: ['z', 'a'] }] }, ['a', 'c'], 'edit gone: insert:>a#b'], // a conflict's suggestion on a removed block
  [{ via: 'suggest', ops: [{ op: 'replace', block: 'b', md: 'mine', _prevs: ['a'] }] }, ['a', 'c'], 'suggest gone: insert:>a#b'],
  [{ via: 'edit', ops: [{ op: 'replace', block: 'a', md: 'x' }] }, ['a', 'c'], null], // nothing in it could be the reason: dropped
], (c) => fix(P.repairOps(c[0], c[1], {})));
group('saveOutcome2', [[{ ok: false, refused: 'absent', message: 'no block' }, 'refused'], [{ ok: true, rev: 3, repeat: true }, 'ok']], (c) => P.saveOutcome(c[0]));

// (l) [each entry's JSON length, the most entries a batch takes, the most characters, how many of the oldest go]
group('batchFit', [
  [[10, 10, 10], 2000, 2000000, 3],            // the whole outbox, tabs mixed or not, in one call
  [[10, 10, 10, 10, 10], 2, 2000000, 2],       // the oldest stretch that fits the count
  [[600, 600, 600], 2000, 1000, 1],            // ... or the size
  [[400, 400, 100, 900], 2000, 1000, 3],
  [[5000, 10], 2000, 1000, 1],                 // one entry bigger than the bound still goes, alone
  [[], 2000, 1000, 0],
], (c) => P.batchFit(c[0], c[1], c[2]));

// the page's string table holds the same keys in both languages
function keysIn(body) {
  const ks = [];
  body = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  let depth = 0, m;
  const re = /([{}])|(?:^|[\s,{])([A-Za-z_]\w*)\s*:/g;
  while ((m = re.exec(body))) { if (m[1] === '{') depth++; else if (m[1] === '}') depth--; else if (!depth) ks.push(m[2]); }
  return ks;
}
const EN = 'pickLang({\n    en: {', HU = '\n    hu: {';
const e0 = src.indexOf(EN), h0 = src.indexOf(HU, e0), z0 = src.indexOf('\n  }, L);', h0);
const en = e0 >= 0 ? keysIn(src.slice(e0 + EN.length, h0)) : [], hu = h0 >= 0 ? keysIn(src.slice(h0 + HU.length, z0)) : [];
out.strings = { found: e0 >= 0 && h0 > e0 && z0 > h0, en: en.length, onlyEn: en.filter((k) => hu.indexOf(k) < 0), onlyHu: hu.filter((k) => en.indexOf(k) < 0),
  has: ['conflict', 'keptGone', 'keptNew', 'retrying'].filter((k) => en.indexOf(k) >= 0 && hu.indexOf(k) >= 0) };
process.stdout.write(JSON.stringify(out));
"""


def fn(src, start, end):
    """The source from `start` up to `end` (both literal), so an assertion speaks of one function."""
    i = src.index(start)
    return src[i:src.index(end, i)]


@unittest.skipUnless(NODE, "node is not installed")
class DocPageTests(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        fd, path = tempfile.mkstemp(suffix=".js")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(SCRIPT)
        try:
            r = subprocess.run([NODE, path, str(PAGE)], capture_output=True, text=True, encoding="utf-8", timeout=120)
        finally:
            os.unlink(path)
        if r.returncode != 0:
            raise AssertionError("node failed:\n" + r.stderr[-4000:])
        cls.out = json.loads(r.stdout)
        cls.src = PAGE.read_text("utf-8").replace("\r\n", "\n")

    def check(self, name, at_least):
        g = self.out[name]
        self.assertEqual(g["fails"], [], name)
        self.assertGreaterEqual(g["n"], at_least, name)

    def test_node_check(self):
        r = subprocess.run([NODE, "--check", str(PAGE)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_read_never_takes_the_block_being_typed_in_out_of_the_page(self):  # (a) (b) (c)
        self.check("placeBlocks", 12)
        self.check("fuzz", 400)

    def test_what_a_read_does_to_the_block_being_typed_in(self):  # (e)
        self.check("onRead", 8)

    def test_a_read_patches_the_page_instead_of_drawing_it_again(self):  # (a) (b) (c) (d)
        merge = fn(self.src, "function merge(full, flash) {", "\n  if (live) {")
        self.assertIn('patch(act === "redraw");', merge)
        self.assertNotIn("render()", merge)
        self.assertEqual(merge.count("focused = null"), 1)  # only when the block is gone and nothing typed there waits
        self.assertIn('if (act === "drop") { clearTimeout(f.timer); focused = null; }', merge)
        patch = fn(self.src, "function patch(redrawMine) {", "\n  function onScreen(")
        self.assertIn("placeBlocks(page, nodes, keep);", patch)
        self.assertNotIn("replaceChildren", patch)
        self.assertIn("el._drawn === drawKey(b) ? el : drawBlock(b, el)", patch)  # only what changed is drawn again
        self.assertIn("if (redrawMine) redrawKept(b, el);", patch)  # the kept block's own DOM only when nothing waits to be saved
        self.assertIn("window.scrollBy(0, dy)", patch)  # (c) what is on screen stays put
        # (d) a read is not held back while the person types (only while their own save is on its way)
        self.assertIn("setInterval(function () { if (!document.hidden && !(focused && sending)) pull(false); }, 2500);", self.src)

    def test_the_kept_block_redrawn_keeps_its_caret_and_focus(self):  # (b)
        kept = fn(self.src, "function redrawKept(b, el) {", "\n  function caretOffset(")
        self.assertIn("off = had ? caretOffset(el) : -1;", kept)
        self.assertIn("tg.focus({ preventScroll: true });", kept)
        self.assertIn("caretAtOffset(tg, off);", kept)

    def test_unsaved_words_and_ime_count_as_the_persons(self):  # (e) (f) and the IME
        self.assertIn('page.addEventListener("compositionstart", function () { composing = true; });', self.src)
        self.assertIn('page.addEventListener("compositionend", function () { composing = false; });', self.src)
        dirty = fn(self.src, "function dirty(f, el) {", "\n")
        for part in ("f.timer", "f.sug", "composing", "pendingFor(f.id)", "mdOf(el) !== f.saved"):
            self.assertIn(part, dirty)
        merge = fn(self.src, "function merge(full, flash) {", "\n  if (live) {")
        self.assertIn("act = onRead(!!srv, !!srv && srv.md === local, dirty(f, fel));", merge)
        self.assertIn('if (act === "keep" || act === "readd") keepMd[mine] = local;', merge)

    def test_a_block_is_unsaved_until_the_server_takes_it(self):  # (f)
        self.check("saveOutcome", 7)
        self.check("saveOutcome2", 2)
        self.check("mergeBlocks", 8)
        ans = fn(self.src, "function answered(e, r) {", "\n  function took(")
        self.assertIn('if (how === "failed") { if (i === 0) failed(); return; }', ans)  # it stays in the outbox
        self.assertIn("outbox.splice(i, 1);", ans)  # only an answer takes it out
        send = fn(self.src, "function send(e) {", "\n  function pump() {")
        self.assertIn("inTime(", send)  # no answer is a failure, not a hang
        f = fn(self.src, "function failed() {", "\n  // Refused")
        self.assertIn("retryMs = Math.min(30000, (retryMs || 1500) * 2);", f)
        self.assertIn("if (!retryMs) kit.toast(T.retrying);", f)  # one message, however often it fails
        self.assertNotIn("kit.toast(String(e && e.message", fn(self.src, "var edits = 0;", "\n  // ------------------------------------------------------------------ editing a block in place"))

    def test_a_late_read_never_rolls_a_block_back(self):  # (g)
        self.check("staleRead", 6)
        merge = fn(self.src, "function merge(full, flash) {", "\n  if (live) {")
        self.assertLess(merge.index("if (seen && staleRead(full.rev, seen.rev, seen.acked)) return;"), merge.index("tabs = full.tabs.map("))
        took = fn(self.src, "function took(e, r) {", "\n  function failed() {")
        self.assertIn("t.acked = Math.max(t.acked || 0, r.rev);", took)

    def test_the_save_is_checked_against_the_rev_its_words_were_typed_from(self):  # (e)
        save = fn(self.src, "function save(final) {", "\n  function redrawOne(")
        self.assertIn("writeBlock(f.id, now, f.sug ? { sug: true } : { base: f.base })", save)
        self.assertIn("f.timer = null;", save)
        send = fn(self.src, "function send(e) {", "\n  function pump() {")
        self.assertIn("baseOf(e);", send)
        self.assertIn("if (!e.sent) { e.sent = true; e.sentBase = e.base != null && e.base < e.t.rev ? e.base : e.t.rev; }", fn(self.src, "function baseOf(e) {", "\n  function send("))  # the same base when sent again
        self.assertIn("hm.doc.edit(t.id, ops, e.sentBase)", send)
        self.assertIn('if (how === "conflict") e.done(conflicted(e.t, e, r, i));', fn(self.src, "function answered(e, r) {", "\n  function took("))
        self.assertIn("base: tab().rev", fn(self.src, "function track(id, el) {", "\n"))
        self.assertNotIn("focused = { id:", self.src)  # every block typed in is tracked with its base

    def test_typing_goes_on_through_a_conflict(self):  # (e) (h)
        c = fn(self.src, "function conflicted(t, e, r, at) {", "\n  // Leaving the page")
        self.assertIn("var text = f && el ? mdOf(el) : o.md;", c)  # what was typed since the save left, too
        self.assertIn("if (f) { f.sug = true; f.saved = text; }", c)  # the block keeps the focus and the words
        self.assertNotIn("focused = null", c)
        self.assertIn('enqueue("suggest", [{ op: "replace", block: bid, md: text }], null, { asBlock: true, say: T.conflict });', c)
        self.assertIn('if (rest.length) enqueue("edit", rest, e.sentBase, {', c)  # a split's new block is not lost with the refused edit
        self.assertNotIn("kit.toast", c)  # said when it is true (took), not before
        self.check("repairOps", 8)  # Hermes removed the block meanwhile: a new block, anchored on one still there
        commit = fn(self.src, "function commit() {", "\n  // Notion's hint")
        self.assertIn("if (f.sug) { var b0 = blockOf(f.id); if (b0 && f.theirs != null) b0.md = f.theirs; pull(true); }", commit)
        self.assertIn("var p = pendingSug(id);", fn(self.src, "function sugFor(id) {", "\n  function sugAfter("))  # a proposal on its way stays in sight
        keys = fn(self.src, 'page.addEventListener("keydown", function (e) {', "\n  function enterInBlock(")
        self.assertIn('if (focused && focused.sug && focused.id === id && (e.key === "Enter"', keys)

    def test_structural_edits_are_one_edit_each_and_kept_until_answered(self):  # (i)
        self.check("replayOps", 10)
        enter = fn(self.src, "function enterInBlock(el) {", "\n  function enterInItem(")
        self.assertIn('splitBlock(id, now, id, after, "start", base);', enter)  # Enter in a paragraph
        self.assertIn('splitBlock(id, "---", id, "", "start", base0);', enter)  # "---" then Enter
        self.assertNotIn("insertBlock(id, after", enter)
        self.assertIn('splitBlock(id, now, id, "", "start", base);', fn(self.src, "function enterInItem(el, li) {", "\n  function indent("))
        self.assertIn('splitBlock(id, rest, prev, lead || "", "start", base);', fn(self.src, "function liftItem(el, li) {", "\n  function mergeUp("))
        self.assertIn('edit([{ op: "replace", block: p.id, md: merged }, { op: "delete", block: id }])', fn(self.src, "function mergeUp(el, b) {", "\n  function caretAtOffset("))
        split = fn(self.src, "function splitBlock(", "\n  function removeBlock(")
        self.assertIn('edit([{ op: "replace", block: id, md: mdText }, { op: "insert", after: after, md: newMd, tmp: tmp }], base != null ? base : tab().rev);', split)
        self.assertIn('return splitBlock(id, "---", id, "", "start");', self.src)  # "/" divider
        paste = fn(self.src, 'page.addEventListener("paste", function (e) {', '\n  page.addEventListener("dragover"')
        self.assertNotIn("save(false).then(", paste)  # the pasted blocks never wait on an earlier save's answer
        self.assertIn('insertBlock(el.getAttribute("data-block"), mdText, null);', paste)
        self.assertIn("var p = edit([{ op: \"delete\", block: id }]);", fn(self.src, "function removeBlock(id) {", "\n\n"))
        self.assertIn('edit([{ op: "move", block: id, after: after }]);', fn(self.src, "function moveBlock(id, after) {", "\n  // Turn a block"))
        merge = fn(self.src, "function merge(full, flash) {", "\n  if (live) {")
        self.assertIn("mergeBlocks(replayOps(full.blocks, outbox, realIds), was, keepMd)", merge)
        mend = fn(self.src, "function mend(e, r) {", "\n  // Hermes changed a block meanwhile")
        self.assertIn("repairOps(e, (e.t.srv || []).slice(), realIds)", mend)
        self.assertNotIn("hm.doc.edit(", self.src.replace("hm.doc.edit(t.id, ops, e.sentBase)", "").replace('hm.doc.edit(tab().id, [{ op: "batch", entries: all.slice(0, n) }], null)', ""))  # every edit goes through the outbox
        self.assertNotIn("hm.doc.suggest(", self.src.replace("hm.doc.suggest(t.id, ops)", ""))

    def test_a_retried_edit_is_applied_once(self):  # (j)
        wire = fn(self.src, "function wire(e) {", "\n  function send(e) {")
        self.assertIn("if (i === 0) x.cid = e.cid;", wire)
        enq = fn(self.src, "function enqueue(via, ops, base, more) {", "\n  /** base:")
        self.assertIn('var n = more && more.n != null ? more.n : ++cidN;', enq)  # one per logical edit; a retry sends the same
        self.assertIn('cid: PAGE + "." + n + (more && more.tag ? "." + more.tag : "")', enq)
        self.assertIn("!last.sent", enq)  # new words join only an entry never sent (a sent one may have landed)
        merge = fn(self.src, "function merge(full, flash) {", "\n  if (live) {")
        self.assertIn("Object.prototype.hasOwnProperty.call(done, outbox[0].cid)", merge)  # its answer lost: settled from the read
        self.assertLess(merge.index("took(e0, r0);"), merge.index("replayOps("))

    def test_leaving_the_page_sends_what_waits(self):  # (k)
        self.assertIn('window.addEventListener("pagehide", function () { flush(true); });', self.src)
        self.assertIn('document.addEventListener("visibilitychange", function () { if (document.hidden) flush(false); });', self.src)
        self.assertIn('window.addEventListener("beforeunload", function (ev) { if (!live || !unsaved()) return; flush(false); ev.preventDefault(); ev.returnValue = ""; });', self.src)
        flush = fn(self.src, "function flush(going) {", "\n  // The answers to a batch")
        self.assertIn("if (focused && blockEl(focused.id)) save(false);", flush)  # no waiting for the pause

    def test_a_flush_sends_one_ordered_batch(self):  # (l)
        self.check("batchFit", 6)
        flush = fn(self.src, "function flush(going) {", "\n  // The answers to a batch")
        self.assertIn("var all = outbox.map(", flush)  # every entry not answered, in order, the one in flight too
        self.assertIn("tab: e.t.id };", flush)  # each entry names its tab: one call for all tabs
        self.assertIn("run = outbox.slice(0, n);", flush)  # the oldest stretch that fits, never a later one
        self.assertIn('hm.doc.edit(tab().id, [{ op: "batch", entries: all.slice(0, n) }], null)', flush)
        self.assertIn("if (!outbox.length || batching) return;", flush)  # one batch at a time
        self.assertNotIn("part", flush.replace("depart", ""))
        self.assertIn("if (leaving || batching || sending", fn(self.src, "function pump() {", "\n  function inTime("))  # the rest after its answer
        self.assertIn("var BATCH_COUNT = 2000, BATCH_CHARS = 1900000", self.src)  # under docs.MAX_BATCH / MAX_BATCH_CHARS
        self.assertNotIn("send(", flush)  # never entries side by side
        self.assertNotIn("e.flying", flush)
        self.assertIn("if (going) leaving = true;", flush)
        self.assertIn("clearTimeout(retryTimer); retryTimer = null;", flush)
        self.assertIn("if (leaving || batching || sending || mending || retryTimer || !outbox.length) return;", fn(self.src, "function pump() {", "\n  function inTime("))
        self.assertIn("if (leaving) return;", fn(self.src, "function failed() {", "\n  // Refused"))  # nothing after pagehide
        ans = fn(self.src, "function batchAnswered(run, r) {", "\n  function wireBatch(")
        self.assertIn('if (i < 0 || how === "held" || how === "failed") return;', ans)  # answered already, or kept in place
        self.assertIn("e.done(conflicted(e.t, e, a, i));", ans)
        self.assertIn("else { took(e, a); e.done(a); }", ans)
        self.assertIn("pump();", ans)  # back to one at a time
        wb = fn(self.src, "function wireBatch(e) {", "\n  function unsaved()")
        self.assertNotIn('k !== "tmp"', wb)  # a tmp id an earlier entry makes is filled in by the server
        c = fn(self.src, "function conflicted(t, e, r, at) {", "\n  // Leaving the page")
        self.assertIn('enqueue("edit", rest, e.sentBase, { at: at || 0, n: e.n, tag: "r" + (++e.fixes) });', c)  # in its place, its n
        self.assertIn('e.cid = PAGE + "." + e.n + ".m" + (++e.fixes);', fn(self.src, "function mend(e, r) {", "\n  // Hermes changed"))

    def test_strings_in_both_languages(self):
        s = self.out["strings"]
        self.assertTrue(s["found"])
        self.assertGreater(s["en"], 100)
        self.assertEqual((s["onlyEn"], s["onlyHu"]), ([], []))
        self.assertEqual(s["has"], ["conflict", "keptGone", "keptNew", "retrying"])


if __name__ == "__main__":
    unittest.main()
