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
  has: ['conflict', 'keptGone', 'retrying'].filter((k) => en.indexOf(k) >= 0 && hu.indexOf(k) >= 0) };
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
        self.assertEqual(s["has"], ["conflict", "keptGone", "retrying"])


def _browser():
    import _browser as B  # noqa: PLC0415 - only these tests start Chrome
    return B


@unittest.skipUnless(_browser().AVAILABLE, "Chrome or node is not installed")
class DocEditingInChrome(unittest.TestCase):
    """Rounds 3 and 4 in a real browser: Code toggles as Bold does and never nests; a click under the last block
    saves nothing until something is typed there; an empty heading has a line's height, a hint and the caret, and
    Enter in it works; Full width shows its state and the stored one agrees; the bar's menus open under their
    button, as tall as their items within the window, ending on a whole row."""

    READY = "await api.sleep(300); for (let i = 0; i < 60; i++) { if (await api.top('window.__events.some(e => e.event === \"ready\")')) break; await api.sleep(150) }"
    EDITS = "api.top('window.__ops.filter(o => o.op === \"doc.edit\").map(o => o.args.ops.map(x => x.op + \":\" + JSON.stringify(x.md || x.set || \"\")).join(\",\"))')"

    @classmethod
    def setUpClass(cls):
        cls.B = _browser()
        from hermes_artifacts import store
        cls.store = store
        cls.host = cls.B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def run_page(self, body, w=1000, h=760):
        aid = self.store.publish(path=str(ROOT / "examples" / "doc"), title="Quote process", type="doc")["id"]
        r = self.B.drive(f"await api.size({w}, {h}); await api.go({json.dumps(self.host.url(aid))}, 800); {self.READY}\n await api.sleep(1000)\n"
                         f"const edits = () => {self.EDITS}\n" + body)
        self.assertIsNone(r.get("err"), r)
        self.assertEqual(r.get("logs"), [], r.get("logs"))
        return aid, r["out"]

    def test_code_toggles_and_never_nests(self):
        _, o = self.run_page("""
          await api.frame('(() => { const p = document.querySelectorAll(".doc-blk p")[0]; p.closest(".doc-blk").focus(); const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 4); getSelection().removeAllRanges(); getSelection().addRange(r) })()')
          await api.sleep(600)
          const btn = '[...document.querySelectorAll(".doc-selbar .doc-sb")].find(b => (b.querySelector("path") || {}).getAttribute && b.querySelector("path").getAttribute("d") === "M9 8l-4 4 4 4M15 8l4 4-4 4")'
          const seen = []
          for (let i = 0; i < 3; i++) {
            await api.frame(btn + '.click()'); await api.sleep(500)
            seen.push([await api.frame('document.querySelectorAll(".doc-blk p")[0].querySelectorAll("code").length'),
                       await api.frame('document.querySelectorAll(".doc-blk p")[0].querySelectorAll("code code").length'),
                       await api.frame(btn + '.getAttribute("aria-pressed")')])
          }
          const md = await api.frame('(() => { const d = document.createElement("div"); d.innerHTML = "<p><code><code><code>Hello</code></code></code> x</p>"; return docEdit.toMd(d) })()')
          return { seen, md }
        """)
        self.assertEqual(o["seen"], [[1, 0, "true"], [0, 0, None], [1, 0, "true"]])
        self.assertEqual(o["md"].strip(), "`Hello` x")  # code nested by an older page is saved as one

    def test_a_click_below_the_last_block_saves_nothing_until_typed(self):
        _, o = self.run_page("""
          await api.frame('scrollTo(0, document.body.scrollHeight)'); await api.sleep(300)
          const at = await api.frame('(() => { const p = document.getElementById("doc-page").getBoundingClientRect(); return [p.left + 40, Math.min(innerHeight - 10, p.bottom + 40)] })()')
          await api.mouse(at[0], at[1]); await api.sleep(400)
          const line = await api.frame('(() => { const g = document.querySelector(".doc-ghost"); return !!g && g === document.activeElement && g.getBoundingClientRect().height > 20 })()')
          await api.clickIn('document.querySelector(".doc-blk h1")'); await api.sleep(1500)
          const untouched = { line: await api.frame('!!document.querySelector(".doc-ghost")'), edits: await edits(), blocks: await api.frame('document.querySelectorAll(".doc-blk[data-block]").length') }
          await api.frame('scrollTo(0, document.body.scrollHeight)'); await api.sleep(300)
          await api.mouse(at[0], at[1]); await api.sleep(300)
          await api.type('Hi'); await api.sleep(1500)
          return { line, untouched, typed: await edits(), blocks: await api.frame('document.querySelectorAll(".doc-blk[data-block]").length') }
        """)
        self.assertTrue(o["line"])
        self.assertEqual(o["untouched"]["edits"], [])  # no edit, so no revision and no history entry
        self.assertFalse(o["untouched"]["line"])  # gone with the focus
        self.assertEqual(o["typed"], ['insert:"Hi"'])
        self.assertEqual(o["blocks"], o["untouched"]["blocks"] + 1)

    def test_an_empty_heading_has_a_line_and_takes_enter(self):
        _, o = self.run_page("""
          await api.clickIn('document.querySelectorAll(".doc-blk p")[1]'); await api.sleep(300)
          await api.frame('document.querySelector(".doc-plus").click()'); await api.sleep(400)
          await api.frame('[...document.querySelectorAll(".doc-rmenu .doc-rm-item")][1].click()'); await api.sleep(700)
          const h2 = await api.frame('(() => { const b = document.activeElement.closest(".doc-blk"), h = b.querySelector("h2"), r = getSelection().getRangeAt(0); return [Math.round(h.getBoundingClientRect().height), getComputedStyle(b, "::before").content !== "none", h.contains(r.startContainer) || r.startContainer === h] })()')
          await api.key('Enter', 'Enter', 13); await api.sleep(600)
          await api.type('after'); await api.sleep(1500)
          await api.frame('(() => { const h = [...document.querySelectorAll(".doc-blk h2")].find(x => !x.textContent); h.closest(".doc-blk").focus(); getSelection().removeAllRanges() })()')
          await api.key('Enter', 'Enter', 13); await api.sleep(400)   // Enter with no caret in the block: no TypeError
          return { h2, edits: await edits() }
        """)
        self.assertGreaterEqual(o["h2"][0], 30)  # a line of a 27 px heading, not 0
        self.assertTrue(o["h2"][1])  # its hint
        self.assertTrue(o["h2"][2])  # and the caret
        self.assertIn('replace:"after"', o["edits"])

    def test_full_width_shows_its_state_and_the_store_agrees(self):
        aid, o = self.run_page("""
          const wb = '[...document.querySelectorAll(".doc-tool")][2]'
          await api.frame(wb + '.click()'); await api.frame(wb + '.click()'); await api.sleep(3500)
          const two = [await api.frame('document.documentElement.classList.contains("doc-wide")'), await api.frame(wb + '.getAttribute("aria-pressed")')]
          await api.frame(wb + '.click()'); await api.sleep(3500)
          return { two, three: [await api.frame('document.documentElement.classList.contains("doc-wide")'), await api.frame(wb + '.getAttribute("aria-pressed")')] }
        """)
        self.assertEqual(o["two"], [False, "false"])
        self.assertEqual(o["three"], [True, "true"])
        r = self.host.api.handle("POST", f"/artifacts/{aid}/op", {}, {"op": "doc.read", "args": {}})
        self.assertEqual(r.get("settings", {}).get("wide"), True)

    def test_menus_open_under_their_button_and_end_on_a_whole_row(self):
        probe = ("(() => { const m = [...document.querySelectorAll('.kit-menu, .doc-rmenu')].pop(); if (!m) return null; const r = m.getBoundingClientRect();"
                 " const rows = [...m.querySelectorAll('button, .doc-rm-swatches')].map(c => c.getBoundingClientRect()).filter(b => b.bottom > r.top + 1.5 && b.top < r.bottom - 1.5);"
                 " return { left: r.left, width: r.width, vw: innerWidth, top: r.top, bottom: r.bottom, vh: innerHeight, cut: rows.filter(b => b.bottom > r.bottom + 0.5).length, scrolls: m.scrollHeight > m.clientHeight + 1,"
                 " lastGap: r.bottom - Math.max(...rows.map(b => b.bottom)) } })()")
        open_ = {"fonts": 'document.querySelectorAll(".doc-tool")[1]', "insert": 'document.querySelector(".doc-plus")'}
        for w, h in ((1000, 760), (400, 760), (1000, 420)):
            body = "const out = {}\n"
            for k, sel in open_.items():
                body += (f"out.{k} = {{ btn: await api.frame({json.dumps(sel + '.getBoundingClientRect().left')}) }}; await api.frame({json.dumps(sel + '.click()')}); await api.sleep(400);"
                         f" Object.assign(out.{k}, await api.frame({json.dumps(probe)})); await api.key('Escape', 'Escape', 27); await api.sleep(300)\n")
            _, o = self.run_page(body + "return out", w=w, h=h)
            for k, m in o.items():
                self.assertIsNotNone(m.get("top"), (w, h, k))
                self.assertLessEqual(m["bottom"], m["vh"] - 7, (w, h, k, m))
                self.assertEqual(m["cut"], 0, (w, h, k, m))  # never through a row
                if m["scrolls"]:
                    self.assertLess(m["lastGap"], 12, (w, h, k, m))  # cut to scroll: on a whole row, not a divider or a hint
                self.assertAlmostEqual(m["left"], max(8, min(m["btn"], m["vw"] - m["width"] - 8)), delta=2, msg=(w, h, k, m))  # under its button, within the window


if __name__ == "__main__":
    unittest.main()
