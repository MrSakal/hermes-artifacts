/* Export containers written here, no library: a minimal MP4 muxer (ftyp, moov, mdat; H.264 from
   WebCodecs' VideoEncoder, AAC from AudioEncoder) and a GIF89a encoder with its own LZW.
   window.MotionEncode = { mp4(tracks), Gif(w, h) }. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ bytes
  function u8(n) { return [n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function u24(n) { return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function str(s) { return Array.prototype.map.call(s, function (c) { return c.charCodeAt(0) & 255; }); }
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  /** A box: type + any mix of byte arrays / Uint8Arrays. */
  function box(type) {
    var parts = Array.prototype.slice.call(arguments, 1), size = 8;
    parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size), o = 0;
    out.set(u32(size), 0); out.set(str(type), 4); o = 8;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function full(type, version, flags) {
    return box.apply(null, [type, [version & 255].concat(u24(flags))].concat(Array.prototype.slice.call(arguments, 3)));
  }
  var MATRIX = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

  // ------------------------------------------------------------------ mp4
  /** tracks: [{kind: "video", width, height, timescale, samples: [{data, dur, key, cts}], avcC: Uint8Array}
   *           {kind: "audio", rate, channels, samples: [{data, dur}], asc: Uint8Array, bitrate}]
   *  Returns Uint8Array: ftyp, moov (sample tables), mdat. Each sample is one chunk. */
  function mp4(tracks) {
    var ftyp = box("ftyp", str("isom"), u32(512), str("isom"), str("iso2"), str("avc1"), str("mp41"));
    var movieTs = 1000;
    function durOf(tr) { var d = 0; tr.samples.forEach(function (s) { d += s.dur; }); return d; }
    function moov(offsets) {
      var maxDur = 0, traks = tracks.map(function (tr, i) {
        var tsc = tr.kind === "video" ? tr.timescale : tr.rate, d = durOf(tr), mdur = Math.round(d * movieTs / tsc);
        if (mdur > maxDur) maxDur = mdur;
        var tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(i + 1), u32(0), u32(mdur), zeros(8), u16(0), u16(i),
          u16(tr.kind === "audio" ? 0x0100 : 0), u16(0), MATRIX,
          u32((tr.kind === "video" ? tr.width : 0) * 65536), u32((tr.kind === "video" ? tr.height : 0) * 65536));
        var mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(tsc), u32(d), u16(0x55c4), u16(0));
        var hdlr = full("hdlr", 0, 0, u32(0), str(tr.kind === "video" ? "vide" : "soun"), zeros(12), str(tr.kind === "video" ? "VideoHandler" : "SoundHandler"), [0]);
        var xmhd = tr.kind === "video" ? full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)) : full("smhd", 0, 0, u16(0), u16(0));
        var dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
        var entry;
        if (tr.kind === "video") {
          entry = box("avc1", zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(tr.width), u16(tr.height),
            u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box("avcC", tr.avcC));
        } else {
          var asc = Array.prototype.slice.call(tr.asc);
          var dsi = [0x05, asc.length].concat(asc);
          var dcd = [0x04, 13 + dsi.length, 0x40, 0x15].concat(u24(0), u32(tr.bitrate || 128000), u32(tr.bitrate || 128000), dsi);
          var esd = [0x03, 3 + dcd.length + 3].concat(u16(1), [0], dcd, [0x06, 1, 0x02]);
          entry = box("mp4a", zeros(6), u16(1), zeros(8), u16(tr.channels), u16(16), u16(0), u16(0), u32(tr.rate * 65536), full("esds", 0, 0, esd));
        }
        var stsd = full("stsd", 0, 0, u32(1), entry);
        // stts: runs of equal durations.
        var runs = [];
        tr.samples.forEach(function (s) { var l = runs[runs.length - 1]; if (l && l[1] === s.dur) l[0]++; else runs.push([1, s.dur]); });
        var stts = full("stts", 0, 0, u32(runs.length), [].concat.apply([], runs.map(function (r) { return u32(r[0]).concat(u32(r[1])); })));
        var boxes = [stsd, stts];
        if (tr.kind === "video") {
          var keys = [];
          tr.samples.forEach(function (s, k) { if (s.key) keys.push(k + 1); });
          if (keys.length < tr.samples.length) boxes.push(full("stss", 0, 0, u32(keys.length), [].concat.apply([], keys.map(u32))));
          if (tr.samples.some(function (s) { return s.cts; })) {
            var cr = [];
            tr.samples.forEach(function (s) { var l = cr[cr.length - 1], v = s.cts || 0; if (l && l[1] === v) l[0]++; else cr.push([1, v]); });
            boxes.push(full("ctts", 1, 0, u32(cr.length), [].concat.apply([], cr.map(function (r) { return u32(r[0]).concat(u32(r[1] >>> 0)); }))));
          }
        }
        boxes.push(full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)));
        var sizes = new Uint8Array(tr.samples.length * 4);
        tr.samples.forEach(function (s, k) { sizes.set(u32(s.data.length), k * 4); });
        boxes.push(full("stsz", 0, 0, u32(0), u32(tr.samples.length), sizes));
        var co = new Uint8Array(tr.samples.length * 4);
        offsets[i].forEach(function (off, k) { co.set(u32(off), k * 4); });
        boxes.push(full("stco", 0, 0, u32(tr.samples.length), co));
        var stbl = box.apply(null, ["stbl"].concat(boxes));
        return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", xmhd, dinf, stbl)));
      });
      var mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(movieTs), u32(maxDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
      return box.apply(null, ["moov", mvhd].concat(traks));
    }
    // Lay the samples out in mdat: video first, then audio.
    var rel = tracks.map(function () { return []; }), pos = 0;
    tracks.forEach(function (tr, i) { tr.samples.forEach(function (s) { rel[i].push(pos); pos += s.data.length; }); });
    var probe = moov(rel), head = ftyp.length + probe.length + 8;
    var mv = moov(rel.map(function (l) { return l.map(function (x) { return x + head; }); }));
    var out = new Uint8Array(ftyp.length + mv.length + 8 + pos), o = 0;
    out.set(ftyp, o); o += ftyp.length;
    out.set(mv, o); o += mv.length;
    out.set(u32(8 + pos), o); out.set(str("mdat"), o + 4); o += 8;
    tracks.forEach(function (tr) { tr.samples.forEach(function (s) { out.set(s.data, o); o += s.data.length; }); });
    return out;
  }

  /** An AudioSpecificConfig for AAC-LC when the encoder gives none. */
  function asc(rate, channels) {
    var idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(rate);
    if (idx < 0) idx = 3;
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
  }

  // ------------------------------------------------------------------ gif
  /** new Gif(w, h); addFrame(rgba Uint8ClampedArray, delayCs); finish() -> Uint8Array.
   *  One global palette (median cut over the first frames given to setPalette), no dithering. */
  function Gif(w, h) {
    var chunks = [], palette = null, lookup = new Int16Array(32768).fill(-1);
    function bytes(a) { chunks.push(a instanceof Uint8Array ? a : new Uint8Array(a)); }
    function nearest(r, g, b) {
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), v = lookup[key];
      if (v >= 0) return v;
      var best = 0, bd = 1e9;
      for (var i = 0; i < palette.length; i++) {
        var p = palette[i], d = (p[0] - r) * (p[0] - r) * 2 + (p[1] - g) * (p[1] - g) * 3 + (p[2] - b) * (p[2] - b);
        if (d < bd) { bd = d; best = i; }
      }
      lookup[key] = best;
      return best;
    }
    function setPalette(samples) {
      var hist = new Map();
      samples.forEach(function (px) {
        for (var i = 0; i < px.length; i += 8) {
          var key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
          hist.set(key, (hist.get(key) || 0) + 1);
        }
      });
      var cols = [];
      hist.forEach(function (n, key) { cols.push([((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4, n]); });
      var boxes = [cols];
      while (boxes.length < 256) {
        var bi = -1, br = 0, bc = 0;
        boxes.forEach(function (bx, i) {
          if (bx.length < 2) return;
          for (var c = 0; c < 3; c++) {
            var mn = 255, mx = 0;
            bx.forEach(function (p) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; });
            var score = (mx - mn) * Math.log(1 + bx.length);
            if (score > br) { br = score; bi = i; bc = c; }
          }
        });
        if (bi < 0) break;
        var bx = boxes[bi].sort(function (a, b) { return a[bc] - b[bc]; }), tot = 0, half = 0, cut = 1;
        bx.forEach(function (p) { tot += p[3]; });
        for (var k = 0; k < bx.length - 1; k++) { half += bx[k][3]; if (half >= tot / 2) { cut = k + 1; break; } }
        boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
      }
      palette = boxes.filter(function (b) { return b.length; }).map(function (bx) {
        var r = 0, g = 0, b = 0, n = 0;
        bx.forEach(function (p) { r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; n += p[3]; });
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      });
      while (palette.length < 256) palette.push([0, 0, 0]);
      bytes(str("GIF89a").concat([w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0]));
      bytes([].concat.apply([], palette));
      bytes([0x21, 0xff, 0x0b].concat(str("NETSCAPE2.0"), [3, 1, 0, 0, 0]));
    }
    function lzw(idx) {
      var minCode = 8, clear = 256, eoi = 257, out = [], cur = 0, nbits = 0, size = minCode + 1;
      var dict = new Map(), next = 258;
      function emit(code) {
        cur |= code << nbits; nbits += size;
        while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; }
      }
      emit(clear);
      var prefix = idx[0];
      for (var i = 1; i < idx.length; i++) {
        var k = idx[i], key = prefix * 256 + k, v = dict.get(key);
        if (v !== undefined) { prefix = v; continue; }
        emit(prefix);
        if (next < 4096) {
          dict.set(key, next++);
          if (next > (1 << size) && size < 12) size++;
        } else { emit(clear); dict.clear(); next = 258; size = minCode + 1; }
        prefix = k;
      }
      emit(prefix); emit(eoi);
      if (nbits > 0) out.push(cur & 255);
      var blocks = [minCode];
      for (var j = 0; j < out.length; j += 255) { var n = Math.min(255, out.length - j); blocks.push(n); for (var q = 0; q < n; q++) blocks.push(out[j + q]); }
      blocks.push(0);
      return new Uint8Array(blocks);
    }
    return {
      setPalette: setPalette,
      addFrame: function (px, delayCs) {
        var n = w * h, idx = new Uint8Array(n);
        for (var i = 0, p = 0; i < n; i++, p += 4) idx[i] = nearest(px[p], px[p + 1], px[p + 2]);
        bytes([0x21, 0xf9, 4, 0x04, delayCs & 255, delayCs >> 8, 0, 0]);
        bytes([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0]);
        bytes(lzw(idx));
      },
      finish: function () {
        bytes([0x3b]);
        var len = 0; chunks.forEach(function (c) { len += c.length; });
        var out = new Uint8Array(len), o = 0;
        chunks.forEach(function (c) { out.set(c, o); o += c.length; });
        return out;
      }
    };
  }

  window.MotionEncode = { mp4: mp4, asc: asc, Gif: Gif };
})();
