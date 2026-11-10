/* DC: the .dc.html Design Component format: parse a file, serialize it back, render it.
 *
 * A .dc.html is a whole HTML document. Between <x-dc> and the last </x-dc> is the template: a
 * <helmet> (page styles and font links, injected into the head), markup with {{holes}} (dotted
 * lookups into renderVals()), <sc-for list as>, <sc-if value>, <dc-import name> child components
 * (sibling files) and JSX camelCase events (onClick="{{fn}}"). <script type="text/x-dc"
 * data-dc-script data-props='{...}'> holds `class Component extends DCLogic` and its tweakable props.
 *
 * parse() keeps the source around the template byte for byte, so serialize() after an edit changes
 * only the template. Elements are numbered in document order (tid) and addressed by child position
 * (path), as the view context names them. render: DC.mount() renders a file into a document, keeps
 * the component's state across updates and patches the DOM in place (focus and caret survive).
 * Exposes window.DC. Runs in the editor (parse, serialize, edit) and in each artboard frame (render).
 */
(function () {
  "use strict";
  var HTML_NS = "http://www.w3.org/1999/xhtml";
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1, param: 1 };
  var RAW = { style: 1, script: 1, xmp: 1, noembed: 1, noframes: 1 };
  var HOLE = /\{\{\s*([^{}]*?)\s*\}\}/g, ONE = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/;
  var CONTROL = { "sc-for": 1, "sc-if": 1 };
  var SKIP = { script: 1, iframe: 1, object: 1, embed: 1, frame: 1, frameset: 1, base: 1, meta: 1, template: 1, noscript: 1 };
  var INLINE = { b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, span: 1, br: 1, a: 1, code: 1, small: 1, sup: 1, sub: 1, mark: 1, abbr: 1,
    time: 1, q: 1, cite: 1, kbd: 1, del: 1, ins: 1 };

  // ------------------------------------------------------------------ parse

  /** One file: {src, pre, post, tpl (DocumentFragment), names, head:{lang,title,links,scripts}, code, props, propsError, nodes}. */
  function parse(src) {
    src = String(src == null ? "" : src);
    var low = src.toLowerCase(), m = /<x-dc\b[^>]*>/i.exec(src), open, close, missing = false;
    if (m) {
      open = m.index + m[0].length;
      close = low.lastIndexOf("</x-dc>");
      if (close < open) close = src.length;
    } else {
      missing = true;
      var b = /<body\b[^>]*>/i.exec(src);
      open = b ? b.index + b[0].length : 0;
      close = low.lastIndexOf("</body>");
      if (close < open) close = src.length;
    }
    var inner = src.slice(open, close), names = {};
    // The parser lowercases attribute names: remember how the source spelled them (onClick, viewBox).
    var an = /[\s"']([A-Za-z_:][\w:.-]*)\s*=/g, x;
    while ((x = an.exec(inner))) if (/[A-Z]/.test(x[1])) names[x[1].toLowerCase()] = x[1];
    var t = document.createElement("template");
    t.innerHTML = inner;
    var res = { src: src, pre: src.slice(0, open), post: src.slice(close), tpl: t.content, names: names, missing: missing,
      head: { lang: "", title: "", links: [], scripts: [] }, code: "", props: {}, propsError: null, nodes: [] };
    try {
      var d = new DOMParser().parseFromString(src, "text/html");
      res.head.lang = d.documentElement.getAttribute("lang") || "";
      res.head.title = (d.querySelector("head > title") || {}).textContent || "";
      d.querySelectorAll("head link[href]").forEach(function (l) {
        if (/\bstylesheet\b/i.test(l.getAttribute("rel") || "")) res.head.links.push(l.getAttribute("href"));
      });
      d.querySelectorAll("head script[src]").forEach(function (s) {
        var u = s.getAttribute("src");
        if (!/(^|\/)support\.js$/.test(u)) res.head.scripts.push(u);
      });
      var sc = d.querySelector("script[data-dc-script]");
      if (sc) {
        res.code = sc.textContent || "";
        var raw = sc.getAttribute("data-props");
        if (raw) { try { res.props = JSON.parse(raw) || {}; } catch (e) { res.propsError = "data-props: " + e.message; } }
      }
    } catch (e) {}
    index(res);
    return res;
  }

  /** Number the template's elements: tid in document order, path by child position (helmet included). */
  function index(res) {
    var nodes = [];
    (function walk(parent, prefix) {
      var k = 0;
      for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
        var path = prefix ? prefix + "/" + k : String(k);
        c.__dcTid = nodes.length; c.__dcPath = path;
        nodes.push(c);
        walk(c, path);
        k++;
      }
    })(res.tpl, "");
    res.nodes = nodes;
    return res;
  }

  // ------------------------------------------------------------------ serialize
  // & is written as is unless it would read as a character reference (round trip: &family= stays).
  var NBSP = new RegExp(String.fromCharCode(160), "g");
  function escText(s) { return s.replace(/&(?=[A-Za-z0-9#])/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(NBSP, "&nbsp;"); }
  function escAttr(s) { return s.replace(/&(?![A-Za-z0-9]+=|[^A-Za-z0-9#])/g, "&amp;").replace(/"/g, "&quot;").replace(NBSP, "&nbsp;"); }
  function serNodes(parent, names, raw) {
    var out = "";
    for (var n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += raw ? n.data : escText(n.data);
      else if (n.nodeType === 8) out += "<!--" + n.data + "-->";
      else if (n.nodeType === 1) {
        var tag = n.localName;
        out += "<" + tag;
        for (var i = 0; i < n.attributes.length; i++) {
          var a = n.attributes[i], name = names[a.name] || a.name;
          out += a.value === "" && !/^(value|alt|style|src|href)$/.test(a.name) ? " " + name : " " + name + '="' + escAttr(a.value) + '"';
        }
        out += ">";
        if (VOID[tag] && n.namespaceURI === HTML_NS) continue;
        out += serNodes(tag === "template" ? n.content : n, names, RAW[tag] && n.namespaceURI === HTML_NS);
        out += "</" + tag + ">";
      }
    }
    return out;
  }
  /** The whole file again: the source around the template unchanged, the template as edited. */
  function serialize(res) { return res.pre + serNodes(res.tpl, res.names, false) + res.post; }

  // ------------------------------------------------------------------ template queries and edits
  function topHelmet(res) {
    for (var c = res.tpl.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "helmet") return c;
    return null;
  }
  function inHelmet(node) {
    for (var p = node; p; p = p.parentNode) if (p.localName === "helmet") return true;
    return false;
  }
  /** Literal text the viewer may retype in place: no holes, only inline tags inside. */
  function textEditable(node) {
    if (!node || node.nodeType !== 1 || node.namespaceURI !== HTML_NS || inHelmet(node)) return false;
    var tag = node.localName;
    if (VOID[tag] || SKIP[tag] || CONTROL[tag] || /^(dc-import|x-import|helmet|style|svg|select|textarea|table|tr|tbody|thead|ul|ol)$/.test(tag)) return false;
    if (!node.textContent.trim() || node.textContent.indexOf("{{") >= 0) return false;
    var ok = true;
    node.querySelectorAll("*").forEach(function (e) {
      if (!INLINE[e.localName] || e.namespaceURI !== HTML_NS) ok = false;
      for (var i = 0; i < e.attributes.length; i++) if (e.attributes[i].value.indexOf("{{") >= 0) ok = false;
    });
    return ok;
  }
  var KEEP_ATTR = { style: 1, "class": 1, href: 1, title: 1 };
  /** Put typed HTML (from a contenteditable) into a template element: inline tags kept, the rest unwrapped. */
  function applyText(node, html) {
    var t = document.createElement("template");
    t.innerHTML = html;
    var doc = node.ownerDocument, frag = doc.createDocumentFragment();
    (function copy(src, dst) {
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dst.appendChild(doc.createTextNode(n.data)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.localName;
        if (/^(div|p)$/.test(tag)) { // a line the editor made with Enter
          if (dst.lastChild) dst.appendChild(doc.createElement("br"));
          copy(n, dst); continue;
        }
        if (!INLINE[tag]) { copy(n, dst); continue; }
        var e = doc.createElement(tag);
        for (var i = 0; i < n.attributes.length; i++) {
          var a = n.attributes[i];
          if (KEEP_ATTR[a.name] && !(a.name === "href" && /^\s*javascript:/i.test(a.value))) e.setAttribute(a.name, a.value);
        }
        copy(n, e);
        dst.appendChild(e);
      }
    })(t.content, frag);
    while (frag.lastChild && frag.lastChild.nodeName === "BR") frag.removeChild(frag.lastChild);
    node.replaceChildren(frag);
  }

  /** Inline style as [[prop, value]], split on ; outside parentheses and quotes. */
  function parseStyle(s) {
    var out = [], cur = "", depth = 0, q = null;
    s = String(s || "");
    for (var i = 0; i <= s.length; i++) {
      var c = s.charAt(i);
      if (i === s.length || (c === ";" && !depth && !q)) {
        var k = cur.indexOf(":");
        if (k > 0) out.push([cur.slice(0, k).trim().toLowerCase(), cur.slice(k + 1).trim()]);
        cur = ""; continue;
      }
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === "(") depth++; else if (c === ")") depth = Math.max(0, depth - 1);
      cur += c;
    }
    return out.filter(function (d) { return d[0]; });
  }
  function styleText(decls) { return decls.map(function (d) { return d[0] + ": " + d[1]; }).join("; "); }
  function styleGet(s, prop) { var d = parseStyle(s).filter(function (x) { return x[0] === prop; }); return d.length ? d[d.length - 1][1] : ""; }
  /** The style string with prop set to value (an empty value removes it), other declarations in place. */
  function styleSet(s, prop, value) {
    var decls = parseStyle(s), found = false;
    decls = decls.filter(function (d) {
      if (d[0] !== prop) return true;
      if (found || value === "" || value == null) return false;
      d[1] = String(value); found = true; return true;
    });
    if (!found && value !== "" && value != null) decls.push([prop, String(value)]);
    return styleText(decls);
  }

  // ------------------------------------------------------------------ holes
  function lookup(expr, scope, inst) {
    var e = String(expr).trim();
    if (e === "true") return true;
    if (e === "false") return false;
    if (e === "null") return null;
    if (e === "undefined" || e === "") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    var q = /^'([^']*)'$|^"([^"]*)"$/.exec(e);
    if (q) return q[1] != null ? q[1] : q[2];
    var parts = e.replace(/\[(\d+)\]/g, ".$1").split("."), v = scope ? scope[parts[0]] : undefined, owner = null;
    for (var i = 1; i < parts.length && v != null; i++) { owner = v; v = v[parts[i]]; }
    if (typeof v === "function") {
      if (owner && typeof owner === "object") v = v.bind(owner);
      else if (inst && inst.logic && inst.logic[parts[0]] === v) v = v.bind(inst.logic);
    }
    return v;
  }
  function str(v) {
    if (v == null || v === false || v === true) return "";
    if (Array.isArray(v)) return v.map(str).join("");
    if (typeof v === "object" || typeof v === "function") return "";
    return String(v);
  }
  function interp(text, scope, inst) {
    if (text.indexOf("{{") < 0) return text;
    return text.replace(HOLE, function (_, e) { return str(lookup(e, scope, inst)); });
  }
  function cssFromObject(o) {
    return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== false && o[k] !== ""; }).map(function (k) {
      var p = k.indexOf("--") === 0 ? k : k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); });
      var v = o[k];
      if (typeof v === "number" && v !== 0 && !/^(opacity|z-index|font-weight|line-height|flex|flex-grow|flex-shrink|order|zoom)$/.test(p)) v = v + "px";
      return p + ": " + v;
    }).join("; ");
  }
  function toArray(v) {
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    if (typeof v === "number") { var a = []; for (var i = 0; i < Math.min(v, 10000); i++) a.push(i); return a; }
    if (typeof v[Symbol.iterator] === "function" && typeof v !== "string") return Array.from(v);
    return [];
  }

  // ------------------------------------------------------------------ logic
  /** What a Component extends: props, state, setState, forceUpdate and the React class lifecycle. */
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.renderVals = function () { return {}; };
  DCLogic.prototype.setState = function (part, cb) {
    var inst = this.__dcInst;
    var next = typeof part === "function" ? part(this.state, this.props) : part;
    if (inst && !inst.prevState) inst.prevState = this.state;
    if (next != null) this.state = Object.assign({}, this.state, next);
    if (inst) { if (cb) inst.cbs.push(cb); inst.schedule(); }
  };
  DCLogic.prototype.forceUpdate = function (cb) { var inst = this.__dcInst; if (inst) { if (cb) inst.cbs.push(cb); inst.schedule(); } };
  DCLogic.prototype.createRef = function () { return { current: null }; };
  var ReactLike = { createRef: function () { return { current: null }; } };

  var compiled = {};
  function compile(code) {
    if (!code || !code.trim()) return DCLogic;
    if (compiled[code]) return compiled[code];
    var f = new Function("DCLogic", "React", code + "\n;return typeof Component === 'function' ? Component : null;");
    var C = f(DCLogic, ReactLike);
    if (!C) throw new Error("the script defines no class Component");
    return (compiled[code] = C);
  }

  // ------------------------------------------------------------------ render
  function eventName(orig, el) {
    var n = orig.slice(2).toLowerCase();
    if (n === "doubleclick") return "dblclick";
    if (n === "change" && (el.localName === "textarea" || (el.localName === "input" && !/^(checkbox|radio|file|range|color)$/i.test(el.getAttribute("type") || "")))) return "input";
    return n;
  }
  var SAFE_ATTR = /^[A-Za-z_:][\w:.-]*$/;

  /** A mounted component: opts {doc, host, file, parsed, get(path), props, url(ref, file), css(ref, file), live(),
   *  onError(err, file), onRender(), map (WeakMap element -> {tpl, file, inner}), owner, depth}. */
  function Instance(opts) {
    this.opts = opts; this.doc = opts.doc; this.host = opts.host; this.file = opts.file; this.map = opts.map;
    this.kids = {}; this.cbs = []; this.queued = false; this.mounted = false; this.paused = false; this.pending = false;
    this.props = opts.props || {}; this.dead = false;
    this.load(opts.parsed);
  }
  Instance.prototype.fail = function (err) { if (this.opts.onError) this.opts.onError(err, this.file); };
  Instance.prototype.load = function (parsed) {
    this.parsed = parsed;
    if (!parsed) { this.fail(new Error("missing file " + this.file)); return; }
    if (this.logic && this.code === parsed.code) return;
    this.code = parsed.code;
    if (this.logic && this.mounted && this.logic.componentWillUnmount) { try { this.logic.componentWillUnmount(); } catch (e) {} }
    this.logic = null; this.mounted = false;
    var Cls;
    try { Cls = compile(parsed.code); } catch (e) { this.fail(e); Cls = DCLogic; }
    try {
      var L = new Cls(this.props);
      if (!(L instanceof DCLogic)) throw new Error("Component must extend DCLogic");
      L.props = this.props; L.state = L.state || {}; L.__dcInst = this;
      this.logic = L;
    } catch (e) { this.fail(e); this.logic = new DCLogic(this.props); this.logic.__dcInst = this; }
  };
  Instance.prototype.schedule = function () {
    var self = this;
    if (this.queued || this.dead) return;
    this.queued = true;
    Promise.resolve().then(function () { self.queued = false; if (self.paused) { self.pending = true; return; } self.render(); });
  };
  Instance.prototype.setProps = function (props) {
    var prev = this.props;
    this.props = props || {};
    if (this.logic) {
      this.prevProps = prev;
      var C = this.logic.constructor;
      if (C.getDerivedStateFromProps) { try { var d = C.getDerivedStateFromProps(this.props, this.logic.state); if (d) this.logic.state = Object.assign({}, this.logic.state, d); } catch (e) { this.fail(e); } }
      this.logic.props = this.props;
    }
    if (this.paused) this.pending = true; else this.render();
  };
  Instance.prototype.resume = function () { this.paused = false; if (this.pending) { this.pending = false; this.render(); } };
  Instance.prototype.helmet = function () {
    var doc = this.doc, head = doc.head, file = this.file, self = this;
    head.querySelectorAll("[data-dc-helmet]").forEach(function (n) { if (n.getAttribute("data-dc-helmet") === file) n.remove(); });
    var hel = this.parsed && topHelmet(this.parsed);
    if (!hel) return;
    for (var c = hel.firstElementChild; c; c = c.nextElementSibling) {
      var n = null;
      if (c.localName === "style") {
        n = doc.createElement("style");
        n.textContent = fixUrls(interp(c.textContent, this.scope || {}, this), this);
      } else if (c.localName === "link" && /\bstylesheet\b/i.test(c.getAttribute("rel") || "")) {
        var href = c.getAttribute("href") || "";
        if (/^https:\/\/fonts\.googleapis\.com\/css2?\?/.test(href)) {
          n = doc.createElement("link"); n.rel = "stylesheet"; n.href = href; n.crossOrigin = "anonymous";
        } else {
          var css = self.opts.css ? self.opts.css(href, file) : null;
          if (css != null) { n = doc.createElement("style"); n.textContent = fixUrls(css, self); }
        }
      }
      if (n) { n.setAttribute("data-dc-helmet", file); head.appendChild(n); }
    }
  };
  function fixUrls(css, inst) {
    if (!inst.opts.url) return css;
    return String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, ref) {
      var u = inst.opts.url(ref, inst.file);
      return u ? 'url("' + u + '")' : m;
    });
  }
  Instance.prototype.render = function (fresh) {
    if (this.dead || !this.parsed) return;
    var self = this, L = this.logic, vals;
    if (!this.mounted || fresh) this.helmet();
    try { vals = L && L.renderVals ? L.renderVals() || {} : {}; }
    catch (e) { this.fail(e); return; }
    var scope = Object.create(vals && typeof vals === "object" ? vals : {});
    this.scope = scope;
    var frag = this.doc.createDocumentFragment(), counts = {};
    try {
      for (var c = this.parsed.tpl.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && c.localName === "helmet") continue;
        this.build(c, scope, frag, counts);
      }
    } catch (e) { this.fail(e); return; }
    morphChildren(this.host, frag, this);
    this.afterKids();
    this.afterX();
    var prevState = this.prevState, prevProps = this.prevProps;
    this.prevState = null; this.prevProps = null;
    var cbs = this.cbs.splice(0);
    try {
      if (!this.mounted) { this.mounted = true; if (L && L.componentDidMount) L.componentDidMount(); }
      else if (L && L.componentDidUpdate) L.componentDidUpdate(prevProps || this.props, prevState || L.state);
      cbs.forEach(function (f) { f.call(L); });
    } catch (e) { this.fail(e); }
    if (this.opts.onRender) this.opts.onRender(this);
  };
  Instance.prototype.reg = function (el, node) {
    el.__dcT = node; el.__dcOwner = this;
    if (this.map) this.map.set(el, this.opts.owner ? { tpl: this.opts.owner.tpl, file: this.opts.owner.file, inner: true } : { tpl: node, file: this.file });
  };
  Instance.prototype.build = function (node, scope, out, counts) {
    var doc = this.doc, self = this;
    if (node.nodeType === 3) {
      out.appendChild(doc.createTextNode(interp(node.data, scope, this)));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (SKIP[tag] || tag === "helmet") return;
    if (tag === "sc-for") {
      var list = toArray(lookupAttr(node, "list", scope, this)), as = node.getAttribute("as") || "item";
      list.forEach(function (it, i) {
        var s = Object.create(scope); s[as] = it; s.$index = i;
        for (var c = node.firstChild; c; c = c.nextSibling) self.build(c, s, out, counts);
      });
      return;
    }
    if (tag === "sc-if") {
      var v = lookupAttr(node, "value", scope, this);
      if (node.hasAttribute("not") ? !v : v) for (var c2 = node.firstChild; c2; c2 = c2.nextSibling) this.build(c2, scope, out, counts);
      return;
    }
    if (tag === "dc-import") {
      var host = doc.createElement("dc-import"), props = {}, name = node.getAttribute("name") || "";
      for (var i = 0; i < node.attributes.length; i++) {
        var a = node.attributes[i];
        if (a.name === "name" || /^hint-/.test(a.name) || a.name === "style" || a.name === "class") continue;
        var key = (this.parsed.names[a.name] || a.name).replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
        props[key] = attrValue(a.value, scope, this);
      }
      var st = node.getAttribute("style");
      host.setAttribute("style", st ? interp(st, scope, this) + ";display:block" : "display:contents");
      counts[node.__dcTid] = (counts[node.__dcTid] || 0) + 1;
      host.__dcImport = { name: name, file: sibling(this.file, name), props: props, key: node.__dcTid + "@" + counts[node.__dcTid] };
      this.reg(host, node);
      out.appendChild(host);
      return;
    }
    if (tag === "x-import" && this.opts.xi && this.opts.xi.has(node.getAttribute("component-from-global-scope") || "")) {
      out.appendChild(this.ximport(node, scope, counts));
      return;
    }
    var el = doc.createElementNS(node.namespaceURI || HTML_NS, node.localName);
    this.reg(el, node);
    this.attrs(el, node, scope);
    if (tag === "x-import") el.setAttribute("data-dc-ximport", node.getAttribute("component-from-global-scope") || "");
    for (var k = node.firstChild; k; k = k.nextSibling) this.build(k, scope, el, counts);
    if (tag === "textarea" && el.__dcProps && "value" in el.__dcProps) el.textContent = el.__dcProps.value == null ? "" : String(el.__dcProps.value);
    out.appendChild(el);
  };
  /** <x-import component-from-global-scope="Ns.Name"> whose component the frame has (opts.xi): a host that
   *  keeps its place (display:contents) and carries what to render (__dcX); the frame renders it inside
   *  after each render, so it is one element to the editor. */
  Instance.prototype.ximport = function (node, scope, counts) {
    var el = this.doc.createElement("x-import"), name = node.getAttribute("component-from-global-scope") || "";
    this.reg(el, node);
    el.setAttribute("component-from-global-scope", name);
    el.setAttribute("data-dc-ximport", name);
    el.setAttribute("style", "display:contents");
    el.__dcX = this.xspec(node, name, scope, counts);
    return el;
  };
  /** {name, props, children}: attributes as props ("true"/"false" booleans, numbers, class -> className,
   *  style an object, {{hole}} values as they are); children null, a string when only text, else a list of
   *  strings, {x: spec} (a nested x-import) and {html} (other markup). */
  Instance.prototype.xspec = function (node, name, scope, counts) {
    var props = {}, names = this.parsed.names;
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], key = names[a.name] || a.name, m = ONE.exec(a.value);
      if (a.name === "component-from-global-scope" || /^hint-/.test(a.name) || a.name === "key" || a.name === "ref") continue;
      if (/^on[a-z]/i.test(key) && !m) continue; // inline script handlers never run
      if (a.name === "class" || a.name === "classname") key = "className";
      else if (a.name === "for" || a.name === "htmlfor") key = "htmlFor";
      var v = m ? lookup(m[1], scope, this) : xvalue(interp(a.value, scope, this));
      if (key === "style" && typeof v === "string") v = styleObject(fixUrls(v, this));
      props[key] = v;
    }
    var frag = this.doc.createDocumentFragment(), kids = [], text = true;
    for (var c = node.firstChild; c; c = c.nextSibling) this.build(c, scope, frag, counts);
    for (var k = frag.firstChild; k; k = k.nextSibling) {
      if (k.nodeType === 3) kids.push(k.data);
      else if (k.nodeType === 1) { text = false; kids.push(k.__dcX ? { x: k.__dcX } : { html: k.outerHTML }); }
    }
    var children = text ? kids.join("").trim() || null : kids.filter(function (s) { return typeof s !== "string" || s.trim(); });
    return { name: name, props: props, children: children };
  };
  function xvalue(s) {
    if (s === "" || s === "true") return true; // a bare attribute (disabled) is on
    if (s === "false") return false;
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
  }
  function styleObject(s) {
    var o = {};
    parseStyle(s).forEach(function (d) { o[d[0].indexOf("--") === 0 ? d[0] : d[0].replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); })] = d[1]; });
    return o;
  }
  Instance.prototype.afterX = function () {
    var xi = this.opts.xi, self = this;
    if (!xi) return;
    this.host.querySelectorAll("x-import").forEach(function (el) { if (el.__dcOwner === self && el.__dcX) xi.render(el, el.__dcX); });
    xi.sweep();
  };
  function lookupAttr(node, name, scope, inst) {
    var v = node.getAttribute(name);
    return v == null ? undefined : attrValue(v, scope, inst);
  }
  function attrValue(v, scope, inst) {
    var m = ONE.exec(v);
    if (m) return lookup(m[1], scope, inst);
    return v.indexOf("{{") >= 0 ? interp(v, scope, inst) : v;
  }
  function sibling(file, name) {
    var dir = file.indexOf("/") >= 0 ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    return dir + name + ".dc.html";
  }
  Instance.prototype.attrs = function (el, node, scope) {
    var names = this.parsed.names, html = el.namespaceURI === HTML_NS;
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name, orig = names[name] || name, v = a.value;
      if (/^hint-/.test(name) || name === "key") continue;
      if (/^on[a-z]/i.test(name)) {
        var m = ONE.exec(v);
        if (!m) continue; // inline script handlers never run
        var fn = lookup(m[1], scope, this);
        if (typeof fn === "function") (el.__dch || (el.__dch = {}))[eventName(orig, el)] = fn;
        continue;
      }
      if (name === "ref") { var r = ONE.exec(v); if (r) el.__dcRef = lookup(r[1], scope, this); continue; }
      if (name === "classname") name = "class";
      if (name === "htmlfor") name = "for";
      var raw = attrValue(v, scope, this);
      if (/^(value|checked|selected|disabled)$/.test(name) && /^(input|select|textarea|option|button)$/.test(el.localName)) {
        (el.__dcProps || (el.__dcProps = {}))[name] = name === "value" ? (raw == null ? "" : raw) : !!raw && raw !== "false";
        if (name === "value" && el.localName === "textarea") continue;
      }
      if (raw == null || raw === false) continue;
      var s = raw === true ? "" : name === "style" && typeof raw === "object" ? cssFromObject(raw) : str(raw) === "" && typeof raw === "object" ? "" : String(raw);
      if (name === "style") s = fixUrls(s, this);
      if ((name === "src" || name === "poster" || (name === "href" && !html) || name === "xlink:href") && this.opts.url) {
        if (/^\s*javascript:/i.test(s)) continue;
        if (name !== "href" || el.localName === "image") { var u = this.opts.url(s, this.file); if (u) s = u; }
      }
      if (name === "href" && /^\s*javascript:/i.test(s)) continue;
      if (name === "srcset" || name === "srcdoc") continue;
      var attrName = html ? name : (orig.indexOf(":") > 0 ? orig : a.name);
      if (!SAFE_ATTR.test(attrName)) continue;
      try { el.setAttribute(attrName, s); } catch (e) {}
    }
  };
  Instance.prototype.afterKids = function () {
    var self = this, seen = {};
    this.host.querySelectorAll("dc-import").forEach(function (h) {
      if (h.__dcOwner !== self || !h.__dcImport) return;
      var d = h.__dcImport, kid = self.kids[d.key];
      seen[d.key] = 1;
      if (kid && kid.host === h && kid.file === d.file) { kid.setProps(d.props); return; }
      if (kid) kid.unmount();
      var depth = (self.opts.depth || 0) + 1, chain = (self.opts.chain || [self.file]);
      if (depth > 8 || chain.indexOf(d.file) >= 0) { self.fail(new Error("<dc-import name=\"" + d.name + "\"> imports itself")); return; }
      var parsed = self.opts.get(d.file);
      if (!parsed) { self.fail(new Error("<dc-import name=\"" + d.name + "\">: no file " + d.file)); return; }
      self.kids[d.key] = new Instance(Object.assign({}, self.opts, { host: h, file: d.file, parsed: parsed, props: d.props, depth: depth,
        chain: chain.concat([d.file]), owner: self.opts.owner || { tpl: h.__dcT, file: self.file }, onRender: null }));
      self.kids[d.key].render();
    });
    Object.keys(this.kids).forEach(function (k) { if (!seen[k]) { self.kids[k].unmount(); delete self.kids[k]; } });
  };
  Instance.prototype.unmount = function () {
    if (this.dead) return;
    this.dead = true;
    Object.keys(this.kids).forEach(function (k) { this.kids[k].unmount(); }, this);
    if (this.logic && this.mounted && this.logic.componentWillUnmount) { try { this.logic.componentWillUnmount(); } catch (e) {} }
  };
  /** Every file this instance and its children render from. */
  Instance.prototype.files = function () {
    var out = [this.file];
    Object.keys(this.kids).forEach(function (k) { out = out.concat(this.kids[k].files()); }, this);
    return out;
  };
  /** Reparse: the files changed; the whole tree takes the new templates, keeping state. */
  Instance.prototype.reloadTree = function (changed) {
    if (changed.indexOf(this.file) >= 0) this.load(this.opts.get(this.file));
    Object.keys(this.kids).forEach(function (k) {
      var kid = this.kids[k];
      // A changed child is mounted again from its new file on this render; others keep their state.
      if (changed.indexOf(kid.file) >= 0) { kid.unmount(); delete this.kids[k]; } else kid.reloadTree(changed);
    }, this);
  };
  Instance.prototype.refresh = function (changed) {
    this.reloadTree(changed);
    if (this.paused) this.pending = true; else this.render(true);
  };

  // ------------------------------------------------------------------ patch in place
  function same(o, n) {
    if (o.nodeType !== n.nodeType) return false;
    if (o.nodeType !== 1) return true;
    return o.localName === n.localName && o.namespaceURI === n.namespaceURI && o.__dcT === n.__dcT && !o.__dcX === !n.__dcX &&
      (!n.__dcImport || (o.__dcImport && o.__dcImport.key === n.__dcImport.key && o.__dcImport.file === n.__dcImport.file));
  }
  function morphChildren(oldP, newP, inst) {
    var olds = Array.prototype.slice.call(oldP.childNodes), news = Array.prototype.slice.call(newP.childNodes);
    for (var i = 0; i < news.length; i++) {
      var o = olds[i], n = news[i];
      if (o && same(o, n)) morph(o, n, inst);
      else if (o) { oldP.replaceChild(n, o); fresh(n, inst); }
      else { oldP.appendChild(n); fresh(n, inst); }
    }
    for (var j = news.length; j < olds.length; j++) if (olds[j].parentNode === oldP) oldP.removeChild(olds[j]);
  }
  function fresh(n, inst) {
    if (n.nodeType !== 1) return;
    bind(n, inst); props(n); ref(n);
    for (var c = n.firstElementChild; c; c = c.nextElementSibling) if (c.__dcOwner === inst || !c.__dcOwner) fresh(c, inst);
  }
  function morph(o, n, inst) {
    if (o.nodeType === 3 || o.nodeType === 8) { if (o.data !== n.data) o.data = n.data; return; }
    var i, a;
    for (i = o.attributes.length - 1; i >= 0; i--) {
      a = o.attributes[i];
      if (a.name === "contenteditable" || a.name === "spellcheck") continue;
      if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    }
    for (i = 0; i < n.attributes.length; i++) {
      a = n.attributes[i];
      if (o.getAttribute(a.name) !== a.value) { try { o.setAttribute(a.name, a.value); } catch (e) {} }
    }
    o.__dch = n.__dch; o.__dcProps = n.__dcProps; o.__dcRef = n.__dcRef; o.__dcImport = n.__dcImport; o.__dcOwner = n.__dcOwner; o.__dcT = n.__dcT;
    o.__dcX = n.__dcX;
    if (inst.map && inst.map.has(n)) inst.map.set(o, inst.map.get(n));
    bind(o, inst); props(o); ref(o);
    if (o.localName === "dc-import" || o.__dcX) return; // its own component renders inside
    morphChildren(o, n, inst);
  }
  function bind(el, inst) {
    if (!el.__dch) return;
    el.__dcl = el.__dcl || {};
    Object.keys(el.__dch).forEach(function (k) {
      if (el.__dcl[k]) return;
      el.__dcl[k] = 1;
      el.addEventListener(k, function (e) {
        var f = el.__dch && el.__dch[k], owner = el.__dcOwner || inst;
        if (!f || (owner.opts.live && !owner.opts.live())) return;
        try { f(e); } catch (err) { owner.fail(err); }
      });
    });
  }
  function props(el) {
    var p = el.__dcProps;
    if (!p) return;
    Object.keys(p).forEach(function (k) {
      var v = k === "value" ? String(p[k]) : p[k];
      if (el[k] !== v) { try { el[k] = v; } catch (e) {} }
    });
  }
  function ref(el) {
    var r = el.__dcRef;
    if (!r) return;
    if (typeof r === "function") { try { r(el); } catch (e) {} } else if (typeof r === "object") r.current = el;
  }

  /** Mount a parsed file into opts.host: returns the Instance (render() has run). */
  function mount(opts) {
    var inst = new Instance(opts);
    inst.render(true);
    return inst;
  }

  window.DC = { parse: parse, index: index, serialize: serialize, textEditable: textEditable, applyText: applyText,
    styleGet: styleGet, styleSet: styleSet, mount: mount, DCLogic: DCLogic, sibling: sibling };
})();
