/* Design systems for every type runtime: compile a tokens.json into tokens.css, the CSS a page wears,
 * and load one from Hermes. Exposes window.dsKit:
 *
 *   dsKit.compile(tokens, opts?) -> {css, problems}   tokens.css exactly as the design-system format
 *        compiles it; problems: [{family, name, reason}] for every value that dropped. opts.fonts
 *        ({path: url}) puts @font-face rules in with those urls; opts.fonts === false leaves them out;
 *        no opts: @font-face with the relative file paths (a tokens.css that sits beside fonts/).
 *   dsKit.css(ds) -> string                            compiled tokens, @font-face from ds.fonts
 *        ({path: data URI}) per tokens.json type.fonts, then ds.css (the system's bundle.css).
 *   dsKit.local(record) -> ds|null                     the copy this artifact carries (ds/<namespace>/)
 *   dsKit.load(id?) -> Promise<ds|null>                hermes.ds.get(id): {id, title, version, tokens,
 *        css, fonts, readme}; no id: the default design system; none: null.
 *   dsKit.themes(ds|tokens) -> [{id, name}]            the color themes, the first is the fallback.
 *   dsKit.model(tokens) -> the normalized tokens the page reads (themes, colors, type, families),
 *        with resolve(name, theme) for a color or shadow's value in a theme (aliases followed).
 */
(function () {
  "use strict";

  var NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
  var HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var FN = /^(rgba?|hsla?|oklch|oklab|lab|lch|color)\(([^()]*)\)$/i;
  var LEN = /^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|%)$/;
  var CORE = { color: 1, type: 1, spacing: 1, radius: 1, shadow: 1 };
  var SKIP = { name: 1, version: 1, meta: 1, $schema: 1, description: 1, motion: 1 };
  var CAPS = { themes: 8, colors: 600, fonts: 4096, families: 12, groups: 12, styles: 80, perFamily: 60, otherFamilies: 12 };

  function str(v) { return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; }
  function clamp(s, n) { s = str(s); return s.length > n ? s.slice(0, n) : s; }
  function cleanName(v) { return str(v).replace(/^(--|\.)/, ""); }
  function cssName(n) { return n.replace(/\./g, "\\."); }
  function cssClass(n) { return window.CSS && CSS.escape ? CSS.escape(n) : n.replace(/\./g, "\\.").replace(/^(\d)/, "\\3$1 "); }
  function isList(f) { return f && typeof f === "object" && Array.isArray(f.tokens); }

  function colorValue(v) {
    v = str(v);
    if (HEX.test(v)) return { ok: v.toLowerCase() };
    var m = FN.exec(v);
    if (m) {
      var args = m[2].replace(/(srgb-linear|srgb|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz-d50|xyz-d65|xyz|none)/gi, " ")
        .replace(/(\d)(deg|grad|rad|turn)/gi, "$1");
      if (/^[\d\s.,%\/+-]*$/.test(args) && /\d/.test(args)) return { ok: v };
      return { bad: "a colour function takes plain numbers only (no var(), url(), color-mix(), names)" };
    }
    var a = /^\{([^{}]+)\}$/.exec(v);
    if (a) return { alias: cleanName(a[1]) };
    if (/^var\(/i.test(v)) return { bad: "var() is not a colour value; alias another token as \"{name}\"" };
    if (/^color-mix\(/i.test(v)) return { bad: "color-mix() is not read; write the mixed colour" };
    if (/^[a-z]+$/i.test(v)) return { bad: "named colours (\"" + v + "\") drop; write hex or rgb()" };
    return { bad: v ? "not a colour the page reads: " + v.slice(0, 40) : "no value" };
  }

  function length(v, unitless) {
    if (typeof v === "number" && isFinite(v)) return unitless && v < 10 ? String(v) : v + "px";
    v = str(v);
    if (v === "0") return "0";
    if (LEN.test(v)) return v;
    if (unitless && /^\d+(\.\d+)?$/.test(v) && parseFloat(v) < 10) return v;
    if (/^\d+(\.\d+)?$/.test(v)) return v + "px";
    return null;
  }

  function weight(v) {
    if (v === "normal") return "400";
    if (v === "bold") return "700";
    var s = str(v);
    if (/^\d{1,4}$/.test(s) && +s >= 1 && +s <= 1000) return s;
    var r = /^(\d{1,4})\s+(\d{1,4})$/.exec(s);
    if (r && +r[1] >= 1 && +r[2] <= 1000 && +r[1] <= +r[2]) return r[1] + " " + r[2];
    return null;
  }

  function stack(v) {
    v = str(v);
    if (!v || v.length > 200 || /[;{}<>\\()]/.test(v)) return null;
    if ((v.split('"').length - 1) % 2 || (v.split("'").length - 1) % 2) return null;
    return v;
  }

  function shadowValue(v) {
    v = str(v);
    if (!v || v.length > 400) return { bad: v ? "a shadow is at most 400 characters" : "no value" };
    if (/var\(|url\(/i.test(v)) return { bad: "no var() or url() in a shadow" };
    if (!/^[A-Za-z0-9 #%(),.\/+-]+$/.test(v)) return { bad: "not a box-shadow the page reads" };
    var words = v.replace(/#[0-9a-f]+/gi, "").replace(/\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)/gi, "")
      .replace(/-?(\d+(\.\d+)?|\.\d+)(px|rem|em|%)?/g, "").match(/[a-z][a-z-]*/gi) || [];
    for (var i = 0; i < words.length; i++) if (!/^(inset|none)$/i.test(words[i])) return { bad: "named colours and keywords other than inset and none drop" };
    return { ok: v };
  }

  function plainValue(v) {
    v = str(v);
    if (!v || v.length > 200) return null;
    if (!/^[A-Za-z0-9 #%(),.\/+_-]+$/.test(v) || /url\(|var\(/i.test(v)) return null;
    var d = 0;
    for (var i = 0; i < v.length; i++) { if (v[i] === "(") d++; else if (v[i] === ")" && --d < 0) return null; }
    return d === 0 ? v : null;
  }

  function title(key) {
    var s = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** The tokens as the page reads them; every drop is a problem. */
  function model(tokens) {
    tokens = tokens && typeof tokens === "object" ? tokens : {};
    var problems = [], used = {};
    function drop(family, name, reason) { problems.push({ family: family, name: name || "", reason: reason }); }
    function claim(family, name) {
      if (used[name]) { drop(family, name, "the name is used already (" + used[name] + "): a duplicate drops"); return false; }
      used[name] = family; return true;
    }

    // ---- color
    var col = tokens.color, themes = [];
    if (col && !isList(col) && typeof col === "object" && !Array.isArray(col.themes)) drop("color", "", "a name-to-value map: the page reads {\"tokens\": [{name, value, usage}]}");
    (col && Array.isArray(col.themes) ? col.themes : []).forEach(function (t) {
      var id = str(t && (t.id || t.name)).toLowerCase(), nm = str(t && (t.name || t.id));
      if (!NAME.test(id)) return drop("color", id, "a theme id is letters, digits, _ . -");
      if (themes.some(function (x) { return x.id === id; })) return drop("color", id, "a theme listed twice");
      if (themes.length >= CAPS.themes) return drop("color", id, "at most 8 themes");
      themes.push({ id: id, name: nm || id });
    });
    if (!themes.length) themes.push({ id: "default", name: "Default", implicit: true });
    var first = themes[0].id, colors = [];
    (isList(col) ? col.tokens : []).forEach(function (t) {
      var name = cleanName(t && t.name);
      if (!NAME.test(name)) return drop("color", name, "a name is letters, digits, _ . - (no spaces, no /), up to 64");
      if (colors.length >= CAPS.colors) return drop("color", name, "at most 600 colours");
      var raw = t.value, per = {};
      if (raw && typeof raw === "object") themes.forEach(function (th) { if (raw[th.id] != null) per[th.id] = raw[th.id]; });
      else per[first] = raw;
      if (raw && typeof raw === "object") Object.keys(raw).forEach(function (k) {
        if (!themes.some(function (th) { return th.id === k.toLowerCase(); })) drop("color", name, "no theme \"" + k + "\": that value drops");
        else if (per[k.toLowerCase()] == null) per[k.toLowerCase()] = raw[k];
      });
      var vals = {}, bad = [], multi = raw && typeof raw === "object";
      Object.keys(per).forEach(function (th) {
        var r = colorValue(per[th]);
        if (r.bad) bad.push((multi ? th + ": " : "") + r.bad); else vals[th] = r;
      });
      if (!Object.keys(vals).length) return drop("color", name, (bad.join("; ") || "no value") + " (the token drops)");
      bad.forEach(function (b) { drop("color", name, b + " (that theme inherits the first)"); });
      if (!claim("color", name)) return;
      colors.push({ name: name, values: vals, usage: clamp(t.usage, 1000), raw: t });
    });
    // Aliases: to a colour that exists, not itself, no cycle, at most 16 deep.
    var byName = {};
    colors.forEach(function (c) { byName[c.name] = c; });
    function follow(name, th, depth, seen) {
      var c = byName[name];
      if (!c) return null;
      var v = c.values[th] || c.values[first] || c.values[Object.keys(c.values)[0]];
      if (!v) return null;
      if (v.ok) return v.ok;
      if (depth > 16 || seen[v.alias]) return null;
      seen[v.alias] = 1;
      return follow(v.alias, th, depth + 1, seen);
    }
    var before;
    do { before = colors.length; colors = colors.filter(checkAliases); } while (colors.length !== before);
    function checkAliases(c) {
      var keep = false, bad = [], multi = c.raw.value && typeof c.raw.value === "object";
      Object.keys(c.values).forEach(function (th) {
        var v = c.values[th];
        if (!v.alias) { keep = true; return; }
        var why = v.alias === c.name ? "an alias of itself" : !byName[v.alias] ? "an alias of a missing token {" + v.alias + "}" : null;
        if (!why) { var s = {}; s[c.name] = 1; if (follow(v.alias, th, 1, s) == null) why = "an alias cycle or a chain over 16 deep"; }
        if (why) { bad.push((multi ? th + ": " : "") + why); delete c.values[th]; } else keep = true;
      });
      if (!keep) { delete used[c.name]; delete byName[c.name]; drop("color", c.name, bad.join("; ") + " (the token drops)"); }
      else bad.forEach(function (b) { drop("color", c.name, b + " (that theme inherits the first)"); });
      return keep;
    }
    // A value only in a later theme is borrowed for the first.
    colors.forEach(function (c) { if (!c.values[first]) c.values[first] = c.values[Object.keys(c.values)[0]]; });

    // ---- type
    var ty = tokens.type && typeof tokens.type === "object" ? tokens.type : {};
    var families = {}, fkeys = [];
    Object.keys(ty.families && typeof ty.families === "object" ? ty.families : {}).forEach(function (k) {
      var key = str(k).toLowerCase();
      if (!NAME.test(key)) return drop("type", k, "a family key is letters, digits, _ . -");
      if (fkeys.length >= CAPS.families) return drop("type", k, "at most 12 families");
      var s = stack(ty.families[k]);
      if (!s) return drop("type", k, "a font-family stack: ≤200 characters, no ; { } < > \\ ( ), balanced quotes");
      families[key] = s; fkeys.push(key);
    });
    var fonts = [];
    (Array.isArray(ty.fonts) ? ty.fonts : []).forEach(function (f) {
      var fam = str(f && f.family), file = str(f && f.file);
      if (!fam || /["';{}<>\\()]/.test(fam)) return drop("type", fam, "a font's family is a bare name (no quotes)");
      if (!file) return drop("type", fam, "a font needs its file");
      if (file.indexOf("/") < 0) file = "fonts/" + file;
      if (/(^|\/)\.\.(\/|$)|^\/|\\/.test(file)) return drop("type", fam, "a font file is a relative path");
      if (fonts.length >= CAPS.fonts) return drop("type", fam, "too many fonts");
      var w = f.weight == null ? "400" : weight(f.weight);
      if (!w) return drop("type", fam, "weight: \"400\" or \"300 800\"");
      var st = str(f.style || "normal");
      if (!/^(normal|italic|oblique)$/.test(st)) return drop("type", fam, "style: normal, italic or oblique");
      fonts.push({ family: fam, file: file, weight: w, style: st });
    });
    var groups = [], styleNames = {}, nstyles = 0;
    (Array.isArray(ty.groups) ? ty.groups : []).forEach(function (g) {
      if (groups.length >= CAPS.groups) return drop("type", str(g && g.name), "at most 12 type groups");
      var gfam = str(g && g.family).toLowerCase(), out = { name: str(g && g.name) || "Text", family: gfam, styles: [] };
      (Array.isArray(g && g.styles) ? g.styles : []).forEach(function (s) {
        var name = cleanName(s && s.name);
        if (!NAME.test(name)) return drop("type", name, "a style name is letters, digits, _ . -");
        if (styleNames[name]) return drop("type", name, "a style name used twice: the duplicate drops");
        if (nstyles >= CAPS.styles) return drop("type", name, "at most 80 styles");
        var size = length(s.fontSize);
        if (!size) return drop("type", name, "fontSize is a length (px, rem, em, %): the style drops");
        var st = { name: name, fontSize: size, usage: clamp(s.usage, 1000), sample: clamp(s.sample, 200) };
        var fam = str(s.family).toLowerCase() || gfam;
        if (fam && families[fam]) st.family = fam;
        else if (fam) drop("type", name, "no family \"" + fam + "\" in type.families");
        if (s.lineHeight != null) { var lh = length(s.lineHeight, true); if (lh) st.lineHeight = lh; else drop("type", name, "lineHeight: a length or a unitless number below 10"); }
        if (s.fontWeight != null) { var fw = weight(s.fontWeight); if (fw) st.fontWeight = fw.split(" ")[0]; else drop("type", name, "fontWeight: 1–1000"); }
        if (s.letterSpacing != null) { var ls = length(s.letterSpacing); if (ls) st.letterSpacing = ls; else drop("type", name, "letterSpacing: a length"); }
        if (s.fontStyle != null) { if (/^(normal|italic)$/.test(str(s.fontStyle))) st.fontStyle = str(s.fontStyle); else drop("type", name, "fontStyle: normal or italic"); }
        if (s.opticalSize != null) { if (isFinite(+s.opticalSize) && str(s.opticalSize) !== "") st.opticalSize = +s.opticalSize; else drop("type", name, "opticalSize: a number"); }
        styleNames[name] = 1; nstyles++;
        out.styles.push(st);
      });
      groups.push(out);
    });
    if (tokens.type && !Array.isArray(ty.groups) && Object.keys(ty).length && !ty.families && !ty.fonts) drop("type", "", "type is {fonts, families, groups}: the page reads sizes from groups[].styles");

    // ---- spacing, radius, shadow, the other {tokens: []} families
    var fams = [];
    function family(key, kind) {
      var f = tokens[key], out = { key: key, title: title(key), kind: kind, note: clamp(f && f.note, 400), tokens: [] };
      if (!isList(f)) { if (f && typeof f === "object") drop(key, "", "a name-to-value map: the page reads {\"tokens\": [{name, value, usage}]}"); return null; }
      f.tokens.forEach(function (t) {
        var name = cleanName(t && t.name);
        if (!NAME.test(name)) return drop(key, name, "a name is letters, digits, _ . - (no spaces, no /), up to 64");
        if (out.tokens.length >= CAPS.perFamily) return drop(key, name, "at most 60 tokens a family");
        var tok = { name: name, usage: clamp(t.usage, 1000), raw: t };
        if (kind === "length") {
          var v = length(t.value);
          if (!v) return drop(key, name, "a length (px, rem, em, %) or a number");
          tok.value = v;
        } else if (kind === "shadow") {
          var per = {}, vals = {}, bad = [], multi = t.value && typeof t.value === "object";
          if (multi) themes.forEach(function (th) { if (t.value[th.id] != null) per[th.id] = t.value[th.id]; });
          else per[first] = t.value;
          Object.keys(per).forEach(function (th) {
            var r = shadowValue(per[th]);
            if (r.bad) bad.push((multi ? th + ": " : "") + r.bad); else vals[th] = r.ok;
          });
          if (!Object.keys(vals).length) return drop(key, name, (bad.join("; ") || "no value") + " (the token drops)");
          bad.forEach(function (b) { drop(key, name, b + " (that theme inherits the first)"); });
          if (!vals[first]) vals[first] = vals[Object.keys(vals)[0]];
          tok.values = vals; tok.value = vals[first];
        } else {
          var p = plainValue(t.value);
          if (p == null) return drop(key, name, "a plain CSS value: letters, digits, # % ( ) , . / + _ -, no url() or var()");
          tok.value = p;
        }
        if (!claim(key, name)) return;
        out.tokens.push(tok);
      });
      return out;
    }
    [["spacing", "length"], ["radius", "length"], ["shadow", "shadow"]].forEach(function (x) {
      if (tokens[x[0]] != null) { var f = family(x[0], x[1]); if (f) fams.push(f); }
    });
    var others = 0;
    Object.keys(tokens).forEach(function (k) {
      if (CORE[k] || SKIP[k]) return;
      if (!isList(tokens[k])) { if (tokens[k] && typeof tokens[k] === "object") drop(k, "", "kept, not shown: a family is {\"tokens\": [{name, value, usage}]}"); return; }
      if (++others > CAPS.otherFamilies) return drop(k, "", "at most 12 further families");
      var f = family(k, "plain"); if (f) fams.push(f);
    });

    var m = { themes: themes, first: first, colors: colors, type: { families: families, familyKeys: fkeys, fonts: fonts, groups: groups },
      families: fams, problems: problems, note: clamp(col && col.note, 400) };
    m.resolve = function (name, th) { return follow(name, th || first, 0, {}); };
    m.shadow = function (tok, th) { return tok.values ? tok.values[th] || tok.values[first] : tok.value; };
    m.color = function (c, th) { var v = c.values[th] || c.values[first]; return v.ok || "var(--" + cssName(v.alias) + ")"; };
    return m;
  }

  function decl(name, v) { return "  --" + cssName(name) + ": " + v + ";\n"; }

  function fontFaces(m, fonts, problems) {
    var out = "";
    m.type.fonts.forEach(function (f) {
      var url = f.file;
      if (fonts) {
        url = fonts[f.file];
        if (!url) { if (problems) problems.push({ family: "type", name: f.family, reason: f.file + " is not in the system: no @font-face" }); return; }
      }
      var fmt = /\.woff2$/i.test(f.file) ? "woff2" : /\.woff$/i.test(f.file) ? "woff" : /\.otf$/i.test(f.file) ? "opentype" : /\.ttc$/i.test(f.file) ? "collection" : "truetype";
      out += "@font-face {\n  font-family: \"" + f.family + "\";\n  src: url(\"" + String(url).replace(/"/g, "%22") + "\") format(\"" + fmt + "\");\n" +
        "  font-weight: " + f.weight + ";\n  font-style: " + f.style + ";\n  font-display: swap;\n}\n";
    });
    return out;
  }

  function compile(tokens, opts) {
    opts = opts || {};
    var m = model(tokens), css = "", problems = m.problems.slice();
    var first = m.first, aliases = m.colors.filter(function (c) { return Object.keys(c.values).some(function (t) { return c.values[t].alias; }); });
    var shadows = [];
    m.families.forEach(function (f) { if (f.kind === "shadow") shadows = shadows.concat(f.tokens); });
    // Colours and shadows per theme; the first theme also on :root.
    css += ":root, [data-theme=\"" + first + "\"] {\n";
    m.colors.forEach(function (c) { css += decl(c.name, m.color(c, first)); });
    shadows.forEach(function (s) { css += decl(s.name, s.values[first]); });
    css += "}\n";
    m.themes.slice(1).forEach(function (th) {
      var body = "";
      m.colors.forEach(function (c) {
        var v = c.values[th.id];
        if ((v && v !== c.values[first]) || aliases.indexOf(c) >= 0) body += decl(c.name, m.color(c, th.id));
      });
      shadows.forEach(function (s) { if (s.values[th.id] && s.values[th.id] !== s.values[first]) body += decl(s.name, s.values[th.id]); });
      css += "[data-theme=\"" + th.id + "\"] {\n" + body + "}\n";
    });
    var rootBody = "";
    m.families.forEach(function (f) { if (f.kind !== "shadow") f.tokens.forEach(function (t) { rootBody += decl(t.name, t.value); }); });
    m.type.familyKeys.forEach(function (k) { rootBody += decl("font-" + k, m.type.families[k]); });
    if (rootBody) css += ":root {\n" + rootBody + "}\n";
    m.type.groups.forEach(function (g) {
      g.styles.forEach(function (s) {
        css += "." + cssClass(s.name) + " {\n";
        if (s.family) css += "  font-family: var(--font-" + cssName(s.family) + ");\n";
        css += "  font-size: " + s.fontSize + ";\n";
        if (s.lineHeight) css += "  line-height: " + s.lineHeight + ";\n";
        if (s.fontWeight) css += "  font-weight: " + s.fontWeight + ";\n";
        if (s.letterSpacing) css += "  letter-spacing: " + s.letterSpacing + ";\n";
        if (s.fontStyle) css += "  font-style: " + s.fontStyle + ";\n";
        if (s.opticalSize != null) css += "  font-variation-settings: 'opsz' " + s.opticalSize + ";\n";
        css += "}\n";
      });
    });
    if (opts.fonts !== false) css += fontFaces(m, opts.fonts || null, problems);
    return { css: css, problems: problems, model: m };
  }

  function themes(x) {
    var t = x && x.tokens && !x.color ? x.tokens : x;
    return model(t).themes.map(function (th) { return { id: th.id, name: th.name }; });
  }

  function css(ds) {
    if (!ds) return "";
    var c = compile(ds.tokens || {}, { fonts: false }), m = c.model;
    return c.css + fontFaces(m, ds.fonts || {}, null) + (ds.css ? "\n" + ds.css : "");
  }

  /** The copy an artifact carries of a system (ds/<namespace>/, put there when it was published), in the
   *  shape load() gives; null when the record has no copy here. `base` is the copy's folder. */
  function local(rec) {
    var k = window.kit, files = k && k.content && k.content.files, ns = rec && typeof rec === "object" && rec.namespace;
    if (!files || !ns) return null;
    var base = "ds/" + ns + "/", raw = k.fileText(base + "tokens.json"), tokens = {};
    if (raw == null) return null;
    try { tokens = JSON.parse(raw) || {}; } catch (e) {}
    var fonts = {};
    Object.keys(files).forEach(function (p) { if (p.indexOf(base + "fonts/") === 0) fonts[p.slice(base.length)] = files[p]; });
    return { id: rec.artifact, title: rec.title, version: rec.version, base: base, tokens: tokens,
      css: k.fileText(base + "components/bundle.css") || "", fonts: fonts };
  }

  /** A design system as an artifact wears it: `ref` is its record (the copy the artifact carries is used,
   *  with no trip to Hermes), an id, or {id, version} from before the copy; none: the default one. */
  function load(ref, version) {
    var own = local(ref);
    if (own) return Promise.resolve(own);
    if (!window.hermes || !window.hermes.ds) return Promise.resolve(null);
    var id = ref && typeof ref === "object" ? ref.id || ref.artifact : ref, v = ref && typeof ref === "object" ? ref.version : version;
    return window.hermes.ds.get(id ? String(id) : null, typeof v === "number" ? v : null).then(function (d) {
      return d && !d.none && d.id ? d : null;
    }, function () { return null; });
  }

  window.dsKit = { compile: compile, css: css, load: load, local: local, themes: themes, model: model };
})();
