/* hermes-artifacts Model runtime: a 3D viewer and editor for model.json.
 *
 * Content (the artifact's files):
 *   model.json            the model (params, materials, parts, dims, views); see GUIDE.md
 *   meshes/<name>.<ext>   meshes brought in from files (glb, stl, obj, ply, 3mf), as data URLs
 *
 * build.js (window.modelKit) turns the model into a THREE scene; this page shows it (orbit, views,
 * section, measure, dimensions), edits it (select, gizmo, Properties, Parameters, Outline, add, bring
 * in a file, undo/redo), saves it as a new version with a preview picture, and exports it (GLB, STL,
 * OBJ, PLY, PNG, takeoff CSV). three.js comes through hermes.vendor("three.bundle.js") before the
 * first render; a thumbnail never makes a WebGL context.
 */
(function () {
  "use strict";
  window.__hermesDefer = true; // the host's "ready" comes from kit.ready(), after the first real render
  // ------------------------------------------------------------------ strings
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, MK = window.modelKit;
  var L = /^hu\b/i.test(C.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { noHost: "Not connected to Hermes: changes won't be saved.", loading: "Loading the 3D view\u2026", noLib: "The 3D library didn't load. Open the model in Hermes Desktop to see it in 3D.",
      noGL: "This device can't draw 3D here (WebGL is unavailable). The parts and parameters are in the panel.",
      noKit: "The model builder didn't load.", bad: "model.json is missing or not valid JSON.", empty: "This model has no parts yet.",
      params: "Parameters", props: "Properties", outline: "Outline", noParams: "This model has no parameters.",
      noSel: "Select a part to see its properties.", nSel: "parts selected",
      views: "Views", top: "Top", front: "Front", right: "Right", iso: "Iso", named: "Saved views",
      persp: "Perspective (P)", ortho: "Orthographic (P)", fit: "Zoom to fit (F)", fitSel: "Zoom to selection (F)",
      select: "Select (Q)", move: "Move (W)", rotate: "Rotate (E)", scale: "Scale (R)",
      snap: "Snap", snapOff: "No snapping", snapMove: "Move step", snapRot: "Rotate step",
      add: "Add a part", importBtn: "Bring in a mesh file", dropHere: "Drop a mesh file (glb, gltf, stl, obj, ply, 3mf)",
      tooBig: "Mesh files up to 12 MB", badExt: "glb, gltf, stl, obj, ply or 3mf", imported: "Added",
      section: "Section (X)", flip: "Flip", axis: "Axis", measure: "Measure (M)", measureHint: "Click two points. Esc clears.",
      measureHint2: "Click the second point.", dims: "Dimensions (D)", undo: "Undo (Ctrl+Z)", redo: "Redo (Ctrl+Y)",
      save: "Save", saveKey: "Save (Ctrl+S)", saving: "Saving\u2026", saved: "Saved", unsaved: "Unsaved", notSaved: "Not saved",
      conflict: "Changed meanwhile: the new version loads", noSave: "Can't save here", readOnly: "Earlier version: read-only",
      exp: "Export", expGlb: "GLB (glTF binary)", expStl: "STL", expObj: "OBJ", expPly: "PLY", expPng: "Picture of the view (PNG)",
      expCsv: "Quantity takeoff (CSV)", building: "Building\u2026", noView: "Exports need the 3D view",
      panel: "Panel", more: "More", close: "Close",
      dup: "Duplicate (Ctrl+D)", del: "Delete (Del)", hide: "Hide (H)", show: "Show (H)", comment: "Comment",
      ask: "Ask Hermes", askPh: "Ask Hermes about this\u2026", sent: "Sent to the chat", focusPart: "Focus (F)",
      name: "Name", id: "Id", kind: "Kind", at: "Position", rot: "Rotation", scl: "Scale", mat: "Material", tag: "Layer",
      hidden: "Hidden", edges: "Edges", array: "Array", mirror: "Mirror", none: "None", general: "General", geometry: "Geometry",
      placement: "Placement", size: "Size", r: "Radius", r2: "Top radius", h: "Height", tube: "Tube radius", n: "Sides",
      depth: "Depth", bevel: "Bevel", angle: "Angle", profile: "Profile", holes: "Holes", path: "Path", closed: "Closed",
      smooth: "Smooth", sections: "Sections", points: "Points", faces: "Faces", src: "File", fitBox: "Fit into", unit: "Unit",
      of: "Instance of", parts: "Parts", fillet: "Fillet",
      arrLinear: "Linear", arrGrid: "Grid", arrRadial: "Radial", count: "Count", spacing: "Spacing", center: "Centre",
      json: "Edit as JSON", apply: "Apply", badJson: "Not valid JSON",
      color: "Colour", metal: "Metalness", rough: "Roughness", opacity: "Opacity", custom: "Custom colour", presets: "Presets",
      modelMats: "This model's materials", defMat: "Default",
      sharedMat: function (n, k) { return "Changes the material \u201c" + n + "\u201d on " + k + (k === 1 ? " part" : " parts"); },
      layers: "Layers", problems: "Problems", noLayer: "(no layer)", noProblems: "No problems.", exprBad: "Not a number or expression: ",
      copy: "copy", items: "items",
      cId: "Id", cName: "Name", cKind: "Kind", cMat: "Material", cTag: "Layer", cCount: "Count", cX: "Size X (mm)", cY: "Size Y (mm)",
      cZ: "Size Z (mm)", cVol: "Volume (m\u00b3)", cArea: "Area (m\u00b2)", cTVol: "Total volume (m\u00b3)", cTArea: "Total area (m\u00b2)",
      kinds: { box: "Box", cyl: "Cylinder", cone: "Cone", sphere: "Sphere", torus: "Torus", prism: "Prism", extrude: "Extrusion",
        lathe: "Lathe", sweep: "Sweep", loft: "Loft", hull: "Hull", mesh: "Mesh", file: "Mesh file", group: "Group", ref: "Instance" },
      addKinds: { box: "Box", cyl: "Cylinder", sphere: "Sphere", cone: "Cone", prism: "Prism", extrude: "Extrusion (rounded rectangle)",
        lathe: "Lathe (turned body)" },
      about: function (list) { return "(model parts: " + list + ")"; } },
    hu: { noHost: "Nincs kapcsolat a Hermesszel: a m\u00f3dos\u00edt\u00e1sok nem ment\u0151dnek.", loading: "A 3D n\u00e9zet bet\u00f6lt\u00e9se\u2026", noLib: "A 3D k\u00f6nyvt\u00e1r nem t\u00f6lt\u0151d\u00f6tt be. Nyisd meg a modellt a Hermes Desktopban a 3D n\u00e9zethez.",
      noGL: "Ez az eszk\u00f6z itt nem tud 3D-t rajzolni (nincs WebGL). Az elemek \u00e9s a param\u00e9terek a panelen vannak.",
      noKit: "A modell\u00e9p\u00edt\u0151 nem t\u00f6lt\u0151d\u00f6tt be.", bad: "A model.json hi\u00e1nyzik, vagy nem \u00e9rv\u00e9nyes JSON.", empty: "Ebben a modellben m\u00e9g nincs elem.",
      params: "Param\u00e9terek", props: "Tulajdons\u00e1gok", outline: "Szerkezet", noParams: "Ennek a modellnek nincsenek param\u00e9terei.",
      noSel: "Jel\u00f6lj ki egy elemet a tulajdons\u00e1gaihoz.", nSel: "elem kijel\u00f6lve",
      views: "N\u00e9zetek", top: "Fel\u00fcln\u00e9zet", front: "El\u00f6ln\u00e9zet", right: "Jobb oldal", iso: "Izometrikus", named: "Mentett n\u00e9zetek",
      persp: "Perspektivikus (P)", ortho: "Ortogon\u00e1lis (P)", fit: "Mindent mutat (F)", fitSel: "Kijel\u00f6l\u00e9sre nagy\u00edt (F)",
      select: "Kijel\u00f6l\u00e9s (Q)", move: "Mozgat\u00e1s (W)", rotate: "Elforgat\u00e1s (E)", scale: "M\u00e9retez\u00e9s (R)",
      snap: "Illeszt\u00e9s", snapOff: "Nincs illeszt\u00e9s", snapMove: "Mozgat\u00e1si l\u00e9p\u00e9s", snapRot: "Forgat\u00e1si l\u00e9p\u00e9s",
      add: "Elem hozz\u00e1ad\u00e1sa", importBtn: "H\u00e1l\u00f3f\u00e1jl behoz\u00e1sa", dropHere: "Ejts ide egy h\u00e1l\u00f3f\u00e1jlt (glb, gltf, stl, obj, ply, 3mf)",
      tooBig: "Legfeljebb 12 MB-os h\u00e1l\u00f3f\u00e1jl", badExt: "glb, gltf, stl, obj, ply vagy 3mf", imported: "Hozz\u00e1adva",
      section: "Metszet (X)", flip: "Megford\u00edt\u00e1s", axis: "Tengely", measure: "M\u00e9r\u00e9s (M)", measureHint: "Kattints k\u00e9t pontra. Esc: t\u00f6rl\u00e9s.",
      measureHint2: "Kattints a m\u00e1sodik pontra.", dims: "M\u00e9retvonalak (D)", undo: "Visszavon\u00e1s (Ctrl+Z)", redo: "M\u00e9gis (Ctrl+Y)",
      save: "Ment\u00e9s", saveKey: "Ment\u00e9s (Ctrl+S)", saving: "Ment\u00e9s\u2026", saved: "Elmentve", unsaved: "Nincs mentve", notSaved: "Nem siker\u00fclt menteni",
      conflict: "K\u00f6zben megv\u00e1ltozott: bet\u00f6lt\u00f6m az \u00faj verzi\u00f3t", noSave: "Itt nem lehet menteni", readOnly: "Kor\u00e1bbi verzi\u00f3: csak olvashat\u00f3",
      exp: "Export\u00e1l\u00e1s", expGlb: "GLB (glTF bin\u00e1ris)", expStl: "STL", expObj: "OBJ", expPly: "PLY", expPng: "A n\u00e9zet k\u00e9pe (PNG)",
      expCsv: "Mennyis\u00e9gkimutat\u00e1s (CSV)", building: "K\u00e9sz\u00fcl\u2026", noView: "Az exporthoz kell a 3D n\u00e9zet",
      panel: "Panel", more: "Tov\u00e1bbiak", close: "Bez\u00e1r\u00e1s",
      dup: "Duplik\u00e1l\u00e1s (Ctrl+D)", del: "T\u00f6rl\u00e9s (Del)", hide: "Elrejt\u00e9s (H)", show: "Megjelen\u00edt\u00e9s (H)", comment: "Megjegyz\u00e9s",
      ask: "K\u00e9rdezd a Hermest", askPh: "K\u00e9rdezd a Hermest err\u0151l\u2026", sent: "Elk\u00fcldve a chatbe", focusPart: "R\u00e1k\u00f6zel\u00edt\u00e9s (F)",
      name: "N\u00e9v", id: "Azonos\u00edt\u00f3", kind: "T\u00edpus", at: "Hely", rot: "Elforgat\u00e1s", scl: "M\u00e9retar\u00e1ny", mat: "Anyag", tag: "R\u00e9teg",
      hidden: "Rejtett", edges: "\u00c9lek", array: "Kioszt\u00e1s", mirror: "T\u00fckr\u00f6z\u00e9s", none: "Nincs", general: "\u00c1ltal\u00e1nos", geometry: "Geometria",
      placement: "Elhelyez\u00e9s", size: "M\u00e9ret", r: "Sug\u00e1r", r2: "Fels\u0151 sug\u00e1r", h: "Magass\u00e1g", tube: "Cs\u0151sug\u00e1r", n: "Oldalak",
      depth: "Vastags\u00e1g", bevel: "\u00c9llet\u00f6r\u00e9s", angle: "Sz\u00f6g", profile: "Profil", holes: "Lyukak", path: "\u00datvonal", closed: "Z\u00e1rt",
      smooth: "Sima", sections: "Szelv\u00e9nyek", points: "Pontok", faces: "Lapok", src: "F\u00e1jl", fitBox: "Befoglal\u00f3 m\u00e9ret", unit: "M\u00e9rt\u00e9kegys\u00e9g",
      of: "P\u00e9ld\u00e1ny ebb\u0151l", parts: "Elemek", fillet: "Lekerek\u00edt\u00e9s",
      arrLinear: "Line\u00e1ris", arrGrid: "R\u00e1cs", arrRadial: "K\u00f6rk\u00f6r\u00f6s", count: "Darab", spacing: "Oszt\u00e1s", center: "K\u00f6z\u00e9ppont",
      json: "Szerkeszt\u00e9s JSON-k\u00e9nt", apply: "Alkalmaz", badJson: "Nem \u00e9rv\u00e9nyes JSON",
      color: "Sz\u00edn", metal: "F\u00e9mess\u00e9g", rough: "\u00c9rdess\u00e9g", opacity: "\u00c1tl\u00e1tszatlans\u00e1g", custom: "Egyedi sz\u00edn", presets: "El\u0151re megadott",
      modelMats: "A modell anyagai", defMat: "Alap\u00e9rtelmezett",
      sharedMat: function (n, k) { return "A(z) \u201e" + n + "\u201d anyagot m\u00f3dos\u00edtja " + k + " elemen"; },
      layers: "R\u00e9tegek", problems: "Hib\u00e1k", noLayer: "(nincs r\u00e9teg)", noProblems: "Nincs hiba.", exprBad: "Nem sz\u00e1m vagy kifejez\u00e9s: ",
      copy: "m\u00e1solat", items: "db",
      cId: "Azonos\u00edt\u00f3", cName: "N\u00e9v", cKind: "T\u00edpus", cMat: "Anyag", cTag: "R\u00e9teg", cCount: "Darab", cX: "M\u00e9ret X (mm)", cY: "M\u00e9ret Y (mm)",
      cZ: "M\u00e9ret Z (mm)", cVol: "T\u00e9rfogat (m\u00b3)", cArea: "Fel\u00fclet (m\u00b2)", cTVol: "\u00d6sszt\u00e9rfogat (m\u00b3)", cTArea: "\u00d6sszfel\u00fclet (m\u00b2)",
      kinds: { box: "Has\u00e1b", cyl: "Henger", cone: "K\u00fap", sphere: "G\u00f6mb", torus: "T\u00f3rusz", prism: "Prizma", extrude: "Kih\u00faz\u00e1s",
        lathe: "Forg\u00e1stest", sweep: "S\u00f6pr\u00e9s", loft: "\u00c1tmenet", hull: "Burok", mesh: "H\u00e1l\u00f3", file: "H\u00e1l\u00f3f\u00e1jl", group: "Csoport", ref: "P\u00e9ld\u00e1ny" },
      addKinds: { box: "Has\u00e1b", cyl: "Henger", sphere: "G\u00f6mb", cone: "K\u00fap", prism: "Prizma", extrude: "Kih\u00faz\u00e1s (lekerek\u00edtett t\u00e9glalap)",
        lathe: "Forg\u00e1stest (eszterg\u00e1lt)" } }
  }, L);
  kit.degraded(T.noHost); // no host: said once; the page still shows what it has

  var app = document.getElementById("md-app"), viewEl = document.getElementById("md-view"), panelEl = document.getElementById("md-panel");
  var R = Math.round, DEG = Math.PI / 180;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function round(v, p) { var k = Math.pow(10, p == null ? 3 : p), r = Math.round(v * k) / k; return r === 0 ? 0 : r; }
  function errText(e) { return String(e && e.message || e); }
  var NF = {};
  function fmt(v, d) {
    d = d == null ? 1 : d;
    var f = NF[d] || (NF[d] = new Intl.NumberFormat(L === "hu" ? "hu-HU" : "en-US", { maximumFractionDigits: d }));
    return f.format(Math.abs(v) < Math.pow(10, -d) / 2 ? 0 : v);
  }
  var ICON = {
    cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
    move: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
    rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
    scale: "M4 20V11h9v9zM13 11l7-7M15 4h5v5",
    section: "M4 6h16v12H4zM2 12h20",
    ruler: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
    dims: "M4 7v10M20 7v10M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2",
    upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
    fitAll: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
    fitSel: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9z",
    persp: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
    ortho: "M5 5h14v14H5z",
    magnet: "M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4",
    target: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
  };
  function icon(n) {
    return ICON[n] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICON[n] + '"/></svg>' : kit.icon(n);
  }

  // ------------------------------------------------------------------ thumbnail: the saved picture, never WebGL
  var model = kit.json("model.json", null);
  if (C.thumb) {
    var tb = h("div", { "class": "md-thumb" });
    if (typeof C.preview === "string" && /^data:image\//.test(C.preview)) tb.appendChild(h("img", { src: C.preview, alt: "" }));
    else { tb.insertAdjacentHTML("beforeend", icon("cube")); tb.appendChild(h("div", { text: (isObj(model) && model.title) || C.title || "" })); }
    app.replaceChildren(tb);
    kit.ready();
    return;
  }
  if (!isObj(model)) { app.replaceChildren(h("div", { "class": "kit-empty", text: T.bad })); kit.ready(); return; }

  // ------------------------------------------------------------------ state and the model
  var glOK = false, latest = true, stopped = false;
  function editable() { return glOK && latest && !stopped && !!MK; }
  var sel = [], hover = null, tab = null, panelHidden = false, narrow = false, sheetOpen = false;
  var tool = "select", gizmoMode = "translate", snap = { on: true, move: 10, rot: 15 };
  var live = {}, V = {}, P = { values: {}, defs: [], problems: [] }, probs = [], badParts = {};
  var layerOff = {}, localHidden = {}, collapsed = {}, showDims = true;
  var sec = { on: false, axis: "z", t: 0.5, flip: false };
  var built = null, root = null, bbox = null;

  function parts() { return Array.isArray(model.parts) ? model.parts : []; }
  function walk(list, parent, fn, depth) {
    (Array.isArray(list) ? list : []).forEach(function (p, i) {
      if (!isObj(p)) return;
      fn(p, list, i, parent, depth || 0);
      if (p.kind === "group" && Array.isArray(p.parts)) walk(p.parts, p, fn, (depth || 0) + 1);
    });
  }
  function find(id) {
    var r = null;
    walk(parts(), null, function (p, list, i, parent) { if (!r && p.id === id) r = { part: p, list: list, i: i, parent: parent }; });
    return r;
  }
  function allIds() { var o = {}; walk(parts(), null, function (p) { if (p.id != null) o[p.id] = 1; }); return o; }
  function uid(base) {
    base = String(base || "part").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-\d+$/, "").slice(0, 34) || "part";
    var ids = allIds(), n = 1, id = base;
    while (ids[id]) id = base + "-" + (++n);
    return id;
  }
  function label(p) { return String(p && (p.name || p.id) || ""); }
  /** The selected parts without those whose group is selected too (they move with it). */
  function topSel() {
    return sel.filter(function (id) {
      var f = find(id), up = f && f.parent;
      while (up) { if (sel.indexOf(up.id) >= 0) return false; var g = find(up.id); up = g && g.parent; }
      return !!f;
    });
  }

  // values: the params (with the live slider overrides) and the expressions that use them
  function paramsOf(m, over) {
    if (!MK) return { values: {}, defs: [], problems: [] };
    try { return MK.params(m, over) || { values: {}, defs: [], problems: [] }; } catch (e) { return { values: {}, defs: [], problems: [{ path: "params", msg: errText(e) }] }; }
  }
  function refreshParams() {
    P = paramsOf(model);
    V = P.values || {};
    if (Object.keys(live).length) V = paramsOf(model, live).values || V; // the slider's value flows into the params made of it
  }
  function ev(x, d) {
    if (isNum(x)) return x;
    if (typeof x === "string" && x.trim() && MK) { try { var r = MK.evalExpr(x, V); return isNum(r) ? r : d; } catch (e) { return d; } }
    return d;
  }
  function ev3(a, d) { a = Array.isArray(a) ? a : []; return [ev(a[0], d), ev(a[1], d), ev(a[2], d)]; }
  function scl3(s) { if (Array.isArray(s)) return ev3(s, 1); var k = ev(s, 1); return [k, k, k]; }

  // model.json text: 2-space JSON, short arrays and flat objects on one line, keys in the order they came
  function flat(v) { return v === null || typeof v !== "object"; }
  function oneLine(v) {
    if (flat(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(oneLine).join(", ") + "]";
    return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ": " + oneLine(v[k]); }).join(", ") + "}";
  }
  function inlinable(v) {
    var leaf = function (x) { return flat(x) || (Array.isArray(x) && x.every(flat)); };
    if (Array.isArray(v)) return v.every(leaf);
    return Object.keys(v).every(function (k) { return leaf(v[k]); });
  }
  function ser(v, ind) {
    if (flat(v)) return JSON.stringify(isNum(v) || typeof v !== "number" ? v : null);
    if (inlinable(v)) { var one = oneLine(v); if (one.length + ind.length <= 110) return one; }
    var ni = ind + "  ";
    if (Array.isArray(v)) return v.length ? "[\n" + v.map(function (x) { return ni + ser(x, ni); }).join(",\n") + "\n" + ind + "]" : "[]";
    var ks = Object.keys(v).filter(function (k) { return v[k] !== undefined; });
    return ks.length ? "{\n" + ks.map(function (k) { return ni + JSON.stringify(k) + ": " + ser(v[k], ni); }).join(",\n") + "\n" + ind + "}" : "{}";
  }
  function modelText() { return ser(model, "") + "\n"; }

  // ------------------------------------------------------------------ edits: undo/redo, unsaved, rebuild
  var undoStack = [], redoStack = [], savedText = modelText(), pendingMeshes = {}, dirty = false;
  function snapshot() { return { m: JSON.stringify(model), sel: sel.slice() }; }
  function checkpoint() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
  function restoreSnap(s) { model = JSON.parse(s.m); var ids = allIds(); sel = s.sel.filter(function (id) { return ids[id]; }); changed(); }
  function undo() { if (!editable() || !undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); }
  function redo() { if (!editable() || !redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); }
  function meshRefs() { var o = {}; walk(parts(), null, function (p) { if (p.kind === "file" && typeof p.src === "string") o[p.src] = 1; }); return o; }
  function pendingRefs() { var r = meshRefs(); return Object.keys(pendingMeshes).filter(function (p) { return r[p]; }); }
  /** After every edit of the model: unsaved marker, values, a rebuild, the panel, the view context. */
  function changed() {
    dirty = modelText() !== savedText || pendingRefs().length > 0;
    refreshParams();
    status();
    rebuild();
    renderPanel(); drawChrome(); sendView();
  }
  function edit(fn) { if (!editable()) return; checkpoint(); fn(); changed(); }

  // ------------------------------------------------------------------ the page's chrome (built before the 3D loads)
  function btn(ic, title, fn, cls) {
    var b = h("button", { type: "button", "class": "kit-btn" + (cls ? " " + cls : ""), title: title, "aria-label": title, html: ic ? icon(ic) : "" });
    b.addEventListener("click", fn);
    return b;
  }
  function tbtn(text, title, fn, cls) { var b = btn(null, title, fn, "md-txt" + (cls ? " " + cls : "")); b.textContent = text; return b; }
  function sep() { return h("span", { "class": "md-sep", "aria-hidden": "true" }); }
  var msgEl = h("div", { "class": "md-msg", role: "status" }, [h("div", { text: T.loading })]);
  var tipEl = h("div", { "class": "md-tip", hidden: true });
  var dropEl = h("div", { "class": "md-drop", hidden: true, text: T.dropHere });
  var axesEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  axesEl.setAttribute("class", "md-axes"); axesEl.setAttribute("viewBox", "-38 -38 76 76"); axesEl.setAttribute("aria-hidden", "true");
  var statusEl = h("span", { "class": "md-status", "aria-live": "polite" });
  var saveBtn = btn(null, T.saveKey, function () { save(); }, "md-save");
  saveBtn.textContent = T.save; saveBtn.hidden = true;
  var pillL = h("div", { "class": "md-pill md-pill-l", role: "toolbar", "aria-label": T.views });
  var pillR = h("div", { "class": "md-pill md-pill-r", role: "toolbar", "aria-label": T.exp });
  var pillB = h("div", { "class": "md-pill md-pill-b md-wide-only", role: "toolbar", "aria-label": T.select });
  var pillS = h("div", { "class": "md-pill md-pill-s", role: "toolbar", "aria-label": T.props, hidden: true });
  var secCard = h("div", { "class": "md-card", hidden: true }), measCard = h("div", { "class": "md-card", hidden: true, "aria-live": "polite" });
  // above the tools: the measure and section cards, then the selection's pill
  var dock = h("div", { "class": "md-dock" }, [measCard, secCard, pillS]);
  viewEl.append(msgEl, pillL, pillR, pillB, dock, axesEl, tipEl, dropEl);

  function views() { return (Array.isArray(model.views) ? model.views : []).filter(function (v) { return isObj(v) && Array.isArray(v.cam); }); }
  var VIEWS = { iso: [1, -1, 0.85], top: [0, -0.001, 1], front: [0, -1, 0], right: [1, 0, 0] };
  function drawChrome() {
    var ed = editable();
    // views (top left)
    var named = views();
    var viewsBtn = btn("eye", T.views, function () {
      kit.menu(viewsBtn, [["iso", T.iso + "  (0)"], ["front", T.front + "  (1)"], ["right", T.right + "  (2)"], ["top", T.top + "  (3)"]].map(function (x) {
        return { label: x[1], onClick: function () { setView(x[0]); } };
      }).concat(named.length ? [{ hint: T.named }] : [], named.map(function (v) { return { label: String(v.name || v.id).slice(0, 40), onClick: function () { namedView(v); } }; })));
    }, "md-narrow-only");
    viewsBtn.insertAdjacentHTML("beforeend", kit.icon("caretDown"));
    var namedBtn = named.length ? btn(null, T.named, function () {
      kit.menu(namedBtn, named.map(function (v) { return { label: String(v.name || v.id).slice(0, 40), onClick: function () { namedView(v); } }; }));
    }, "md-txt md-wide-only") : null;
    if (namedBtn) { namedBtn.textContent = T.named; namedBtn.insertAdjacentHTML("beforeend", kit.icon("caretDown")); }
    var orthoOn = !!(camera && camera.isOrthographicCamera);
    pillL.replaceChildren.apply(pillL, [viewsBtn,
      tbtn(T.iso, T.iso + " (0)", function () { setView("iso"); }, "md-wide-only"), tbtn(T.top, T.top + " (3)", function () { setView("top"); }, "md-wide-only"),
      tbtn(T.front, T.front + " (1)", function () { setView("front"); }, "md-wide-only"), tbtn(T.right, T.right + " (2)", function () { setView("right"); }, "md-wide-only"),
      namedBtn, h("span", { "class": "md-sep md-wide-only" }),
      btn(orthoOn ? "ortho" : "persp", orthoOn ? T.ortho : T.persp, function () { setOrtho(!(camera && camera.isOrthographicCamera)); drawChrome(); }),
      btn("fitAll", T.fit, function () { fitAll(true); }), btn("fitSel", T.fitSel, function () { focusSel(); }, "md-wide-only")].filter(Boolean));
    pillL.querySelectorAll("button").forEach(function (b) { if (!glOK) b.disabled = true; });
    // file and panel (top right)
    var expBtn = btn("download", T.exp, function () { kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; })); });
    var moreBtn = btn("more", T.more, function () { kit.menu(moreBtn, moreItems()); }, "md-narrow-only");
    var panelBtn = btn("panel", T.panel, function () { togglePanel(); }, panelShown() ? "is-on" : "");
    pillR.replaceChildren(statusEl, saveBtn, moreBtn, expBtn, panelBtn);
    // tools (bottom)
    var items = [];
    if (glOK) {
      if (ed) {
        items.push(toolBtn("cursor", T.select, null), toolBtn("move", T.move, "translate"), toolBtn("rotate", T.rotate, "rotate"), toolBtn("scale", T.scale, "scale"));
        var snapBtn = btn("magnet", T.snap, function () { kit.menu(snapBtn, snapItems()); }, snap.on ? "is-on" : "");
        items.push(snapBtn, sep());
        var addBtn = btn("plus", T.add, function () { kit.menu(addBtn, addItems()); });
        items.push(addBtn, btn("upload", T.importBtn, pickFile), sep());
      }
      items.push(btn("section", T.section, function () { toggleSection(); }, sec.on ? "is-on" : ""),
        btn("ruler", T.measure, function () { setMeasure(tool !== "measure"); }, tool === "measure" ? "is-on" : ""),
        btn("dims", T.dims, function () { toggleDims(); }, showDims ? "is-on" : ""));
      if (ed) {
        var u = btn("undo", T.undo, undo), r = btn("redo", T.redo, redo);
        u.disabled = !undoStack.length; r.disabled = !redoStack.length;
        items.push(sep(), u, r);
      }
    }
    pillB.replaceChildren.apply(pillB, items);
    pillB.hidden = !items.length;
    drawSelPill();
  }
  function toolBtn(ic, title, mode) {
    var on = tool === "select" && gizmoMode === mode;
    return btn(ic, title, function () { setGizmo(mode); }, on ? "is-on" : "");
  }
  function snapItems() {
    var ck = function (b) { return b ? "\u2713 " : "   "; };
    return [{ label: ck(!snap.on) + T.snapOff, onClick: function () { snap.on = false; applySnap(); drawChrome(); } }, { hint: T.snapMove }]
      .concat([1, 10, 100].map(function (s) { return { label: ck(snap.on && snap.move === s) + s + " mm", onClick: function () { snap.on = true; snap.move = s; applySnap(); drawChrome(); } }; }))
      .concat([{ hint: T.snapRot }], [5, 15, 45].map(function (s) { return { label: ck(snap.on && snap.rot === s) + s + "\u00b0", onClick: function () { snap.on = true; snap.rot = s; applySnap(); drawChrome(); } }; }));
  }
  function addItems() {
    return ["box", "cyl", "sphere", "cone", "prism", "extrude", "lathe"].map(function (k) { return { label: T.addKinds[k], onClick: function () { addPart(k); } }; });
  }
  function moreItems() {
    var ed = editable(), out = [];
    if (!glOK) return exportList.map(function (x) { return { label: x.label, onClick: x.run }; });
    if (ed) out.push({ label: T.select, onClick: function () { setGizmo(null); } }, { label: T.move, onClick: function () { setGizmo("translate"); } },
      { label: T.rotate, onClick: function () { setGizmo("rotate"); } }, { label: T.scale, onClick: function () { setGizmo("scale"); } },
      { label: (snap.on ? "\u2713 " : "   ") + T.snap, onClick: function () { snap.on = !snap.on; applySnap(); drawChrome(); } },
      { hint: T.add }, { label: T.addKinds.box, onClick: function () { addPart("box"); } }, { label: T.addKinds.cyl, onClick: function () { addPart("cyl"); } },
      { label: T.addKinds.extrude, onClick: function () { addPart("extrude"); } }, { label: T.importBtn, onClick: pickFile }, { hint: T.views });
    out.push({ label: (sec.on ? "\u2713 " : "   ") + T.section, onClick: toggleSection }, { label: (tool === "measure" ? "\u2713 " : "   ") + T.measure, onClick: function () { setMeasure(tool !== "measure"); } },
      { label: (showDims ? "\u2713 " : "   ") + T.dims, onClick: toggleDims }, { label: T.fitSel, onClick: focusSel });
    if (ed) out.push({ label: T.undo, onClick: undo }, { label: T.redo, onClick: redo });
    return out;
  }
  function status(flashSaved) {
    var txt = "", cls = "";
    if (!latest) txt = T.readOnly;
    else if (saving) txt = T.saving;
    else if (dirty) { txt = T.unsaved; cls = "is-dirty"; }
    else if (flashSaved) txt = T.saved;
    statusEl.textContent = txt; statusEl.className = "md-status " + cls;
    saveBtn.hidden = !(dirty && editable()) || saving;
    if (flashSaved) setTimeout(function () { if (statusEl.textContent === T.saved) statusEl.textContent = ""; }, 2000);
  }

  // the selection pill: the selected part's name and what can be done with it
  function drawSelPill(asking) {
    if (!sel.length || !glOK) { pillS.hidden = true; return; }
    pillS.hidden = false;
    if (asking) return;
    var f = find(sel[0]), name = sel.length > 1 ? sel.length + " " + T.nSel : label(f && f.part);
    var items = [h("span", { "class": "md-selname", title: name, text: name }), btn("target", T.focusPart, focusSel)];
    if (editable()) {
      var hid = sel.every(function (id) { var g = find(id); return g && g.part.hidden; });
      items.push(btn("copy", T.dup, dupSel), btn(hid ? "eye" : "eyeOff", hid ? T.show : T.hide, hideSel), btn("trash", T.del, delSel));
    }
    if (window.hermes && window.hermes.comment) items.push(sep(), btn("comment", T.comment, commentOn));
    if (window.hermes && window.hermes.send) items.push(btn("sparkle", T.ask, askAbout));
    pillS.replaceChildren.apply(pillS, items);
  }

  // ------------------------------------------------------------------ panel tabs: Parameters / Properties / Outline
  function panelShown() { return !panelEl.hidden; }
  function togglePanel(on) {
    panelHidden = on == null ? panelShown() : !on;
    if (narrow) sheetOpen = !panelHidden;
    renderPanel(); drawChrome();
  }
  function setTab(t) { tab = t; panelHidden = false; if (narrow) sheetOpen = true; renderPanel(); drawChrome(); }
  function renderPanel() {
    panelEl.hidden = narrow ? !sheetOpen : panelHidden;
    app.classList.toggle("has-sheet", narrow && sheetOpen);
    if (panelEl.hidden) return;
    if (!tab) tab = P.defs && P.defs.length ? "params" : "outline";
    var focusK = document.activeElement && panelEl.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
    var scroll = panelEl.querySelector(".md-pbody");
    var top = scroll ? scroll.scrollTop : 0;
    var tabBtn = function (k, text) {
      return h("button", { type: "button", role: "tab", "class": "kit-btn md-tab", "aria-selected": String(tab === k), text: text, onclick: function () { setTab(k); } });
    };
    var tabs = h("div", { "class": "md-tabs", role: "tablist" }, [tabBtn("params", T.params), tabBtn("props", T.props), tabBtn("outline", T.outline),
      h("span", { "class": "md-gap" }), btn("close", T.close, function () { togglePanel(false); })]);
    var body = tab === "params" ? paramsPanel() : tab === "props" ? propsPanel() : outlinePanel();
    panelEl.replaceChildren(tabs, body);
    body.scrollTop = top;
    if (focusK) { var el = panelEl.querySelector('[data-k="' + focusK + '"]'); if (el) el.focus(); }
  }
  function note(text) { return h("div", { "class": "md-pnote", text: text }); }
  function row(text, ctl) { return h("label", { "class": "md-row" }, [h("span", { text: text, title: text }), ctl]); }
  function section(title, rows) { return h("section", { "class": "md-sec" }, [h("h3", { text: title })].concat(rows.filter(Boolean))); }
  var NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  /** An input taking a number or an expression of the params; shows the value of an expression;
   *  an invalid one is flagged and not applied. opt: {k, optional, int, ph} */
  function exprInput(raw, onSet, opt) {
    opt = opt || {};
    var ro = !editable();
    var inp = h("input", { type: "text", value: raw == null ? "" : String(raw), spellcheck: "false", "data-k": opt.k, placeholder: opt.ph || "",
      disabled: ro, "aria-label": opt.label || opt.k || "" });
    var out = h("span", { "class": "md-ev" });
    if (typeof raw === "string" && raw.trim() && !NUM.test(raw.trim())) {
      var v = ev(raw, NaN);
      if (isNum(v)) out.textContent = "= " + fmt(v, 2);
      else { out.textContent = "!"; inp.setAttribute("aria-invalid", "true"); }
    }
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") inp.blur();
      if (e.key === "Escape") { inp.value = raw == null ? "" : String(raw); inp.removeAttribute("aria-invalid"); inp.blur(); }
    });
    inp.addEventListener("change", function () {
      var t = inp.value.trim(), val;
      inp.removeAttribute("aria-invalid"); inp.title = "";
      if (!t) {
        if (opt.optional) return onSet(undefined);
        inp.setAttribute("aria-invalid", "true"); return;
      }
      if (NUM.test(t)) val = +t;
      else {
        try {
          if (t.length > 200) throw new Error("longer than 200 characters");
          var r = MK.evalExpr(t, V);
          if (!isNum(r)) throw new Error("not a finite number");
        } catch (e) { inp.setAttribute("aria-invalid", "true"); inp.title = T.exprBad + errText(e); out.textContent = "!"; return; }
        val = t;
      }
      if (opt.int && typeof val === "number") val = R(val);
      if (val === raw) return;
      onSet(val);
    });
    return h("span", { "class": "md-one" }, [inp, out]);
  }
  function vecInput(arr, n, onSet, opt) {
    var cells = [];
    arr = Array.isArray(arr) ? arr : [];
    for (var i = 0; i < n; i++) (function (i) {
      cells.push(h("span", { "class": "md-cell" }, [exprInput(arr[i], function (v) {
        var a = Array.isArray(arr) ? arr.slice() : [];
        while (a.length < n) a.push(opt.fill == null ? 0 : opt.fill);
        if (v === undefined) v = opt.fill == null ? 0 : opt.fill;
        a[i] = v;
        onSet(a);
      }, { k: opt.k + i, ph: opt.ph ? opt.ph[i] : "xyz"[i], label: (opt.label || "") + " " + "xyz"[i] })]));
    })(i);
    return h("span", { "class": "md-vec is-" + n }, cells);
  }
  function setKey(o, k, v) { if (v === undefined) delete o[k]; else o[k] = v; }
  function textInput(val, onSet, k, list) {
    var inp = h("input", { type: "text", value: val == null ? "" : String(val), spellcheck: "false", "data-k": k, disabled: !editable(), list: list || null });
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("change", function () { onSet(inp.value.trim()); });
    return inp;
  }
  function check(val, onSet, k) {
    var c = h("input", { type: "checkbox", "data-k": k, disabled: !editable() });
    c.checked = !!val;
    c.addEventListener("change", function () { onSet(c.checked); });
    return c;
  }
  function selectInput(val, opts, onSet, k) {
    var s = h("select", { "data-k": k, disabled: !editable() }, opts.map(function (o) {
      return o.group ? h("optgroup", { label: o.group }, o.items.map(function (x) { return h("option", { value: x[0], text: x[1] }); })) : h("option", { value: o[0], text: o[1] });
    }));
    s.value = val == null ? "" : String(val);
    s.addEventListener("change", function () { onSet(s.value); });
    return s;
  }

  // Parameters
  var sliding = false;
  function niceStep(span) { var p = Math.pow(10, Math.floor(Math.log10(Math.max(span, 1e-9) / 200))); return p; }
  function paramsPanel() {
    var out = h("div", { "class": "md-pbody", role: "tabpanel" });
    var defs = P.defs || [];
    if (!defs.length) { out.appendChild(note(T.noParams)); return out; }
    defs.forEach(function (d) {
      var name = d.name, val = live[name] != null ? live[name] : (P.values || {})[name];
      if (!isNum(val)) val = ev(d.v, 0);
      var lo = isNum(d.min) ? d.min : Math.min(0, val * 2), hi = isNum(d.max) ? d.max : Math.max(val * 2, lo + 1, 10);
      var step = isNum(d.step) && d.step > 0 ? d.step : niceStep(hi - lo);
      var rng = h("input", { type: "range", min: lo, max: hi, step: step, value: val, "aria-label": d.label || name, "data-k": "pr-" + name });
      var box = h("input", { type: "text", value: fmtIn(val), inputmode: "decimal", "aria-label": d.label || name, "data-k": "pn-" + name });
      rng.addEventListener("pointerdown", function () { sliding = true; });
      rng.addEventListener("input", function () { live[name] = +rng.value; box.value = fmtIn(+rng.value); refreshParams(); requestBuild(); });
      rng.addEventListener("change", function () { sliding = false; commitParam(name, +rng.value); });
      box.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") box.blur(); });
      box.addEventListener("change", function () {
        var t = box.value.trim().replace(",", ".");
        if (!NUM.test(t)) { box.setAttribute("aria-invalid", "true"); return; }
        box.removeAttribute("aria-invalid");
        commitParam(name, +t);
      });
      var raw = model.params && model.params[name], rawV = isObj(raw) ? raw.v : raw;
      var head = h("div", { "class": "md-param-h" }, [document.createTextNode(String(d.label || name)), h("span", { text: (d.label ? name : "") + (d.unit ? " \u00b7 " + d.unit : "") })]);
      var kids = [head, h("div", { "class": "md-range" }, [rng, box])];
      if (typeof rawV === "string" && live[name] == null) kids.push(h("div", { "class": "md-hint", text: "= " + rawV }));
      out.appendChild(h("div", { "class": "md-param" }, kids));
    });
    if (P.problems && P.problems.length) out.appendChild(section(T.problems, P.problems.slice(0, 20).map(probRow)));
    return out;
  }
  function fmtIn(v) { return String(round(v, 4)); }
  function commitParam(name, v) {
    if (!editable()) { live[name] = v; refreshParams(); rebuild(); sendView(); return; }
    delete live[name];
    var cur = model.params && model.params[name];
    if (isObj(cur) && cur.v === v) { refreshParams(); rebuild(); return; }
    edit(function () {
      model.params = model.params || {};
      if (isObj(model.params[name])) model.params[name].v = v; else model.params[name] = v;
    });
  }

  // Properties
  var PROFILE = { rect: ["w", "h"], rrect: ["w", "h", "r"], circle: ["cx", "cy", "r"], ngon: ["cx", "cy", "r", "n"], slot: ["cx", "cy", "length", "r"] };
  function propsPanel() {
    var out = h("div", { "class": "md-pbody", role: "tabpanel" });
    if (!sel.length) { out.appendChild(note(T.noSel)); return out; }
    if (sel.length > 1) {
      out.appendChild(h("div", { "class": "md-ptitle", text: sel.length + " " + T.nSel }));
      sel.slice(0, 40).forEach(function (id) { var f = find(id); out.appendChild(h("div", { "class": "md-psub", text: label(f && f.part) + "  (" + id + ")" })); });
      return out;
    }
    var f = find(sel[0]);
    if (!f) { out.appendChild(note(T.noSel)); return out; }
    var p = f.part, k = p.kind, set = function (key) { return function (v) { edit(function () { setKey(p, key, v); }); }; };
    out.appendChild(h("div", { "class": "md-ptitle", text: label(p) }));
    out.appendChild(h("div", { "class": "md-psub", text: (T.kinds[k] || k || "?") + " \u00b7 " + p.id }));
    // general
    var tags = {}; walk(parts(), null, function (x) { if (typeof x.tag === "string" && x.tag) tags[x.tag] = 1; });
    var dl = h("datalist", { id: "md-tags" }, Object.keys(tags).sort().map(function (t) { return h("option", { value: t }); }));
    out.appendChild(section(T.general, [
      row(T.name, textInput(p.name, function (v) { edit(function () { setKey(p, "name", v || undefined); }); }, "name")),
      row(T.tag, textInput(p.tag, function (v) { edit(function () { setKey(p, "tag", v || undefined); }); }, "tag", "md-tags")), dl,
      row(T.hidden, check(p.hidden, function (v) { edit(function () { setKey(p, "hidden", v || undefined); }); }, "hidden")),
      row(T.edges, check(p.edges !== false, function (v) { edit(function () { setKey(p, "edges", v ? undefined : false); }); }, "edges"))
    ]));
    // geometry by kind
    var g = [];
    var num = function (key, text, o) { g.push(row(text, exprInput(p[key], set(key), Object.assign({ k: key, label: text }, o || {})))); };
    if (k === "box") { g.push(row(T.size, vecInput(p.size, 3, set("size"), { k: "size", label: T.size }))); num("r", T.r, { optional: true }); }
    else if (k === "cyl") { num("r", T.r); num("h", T.h); num("r2", T.r2, { optional: true }); }
    else if (k === "cone") { num("r", T.r); num("h", T.h); }
    else if (k === "sphere") num("r", T.r);
    else if (k === "torus") { num("r", T.r); num("tube", T.tube); }
    else if (k === "prism") { num("n", T.n, { int: true }); num("r", T.r); num("h", T.h); }
    else if (k === "extrude") { profileRows(g, p, "profile"); num("depth", T.depth); num("bevel", T.bevel, { optional: true }); if (Array.isArray(p.holes)) g.push(row(T.holes, h("span", { text: p.holes.length + " " + T.items }))); }
    else if (k === "lathe") { profileRows(g, p, "profile"); num("angle", T.angle, { optional: true, ph: "360" }); }
    else if (k === "sweep") {
      profileRows(g, p, "profile");
      g.push(row(T.path, h("span", { text: (Array.isArray(p.path) ? p.path.length : 0) + " " + T.points })));
      g.push(row(T.closed, check(p.closed, function (v) { edit(function () { setKey(p, "closed", v || undefined); }); }, "closed")));
      g.push(row(T.smooth, check(p.smooth, function (v) { edit(function () { setKey(p, "smooth", v || undefined); }); }, "smooth")));
    }
    else if (k === "loft") g.push(row(T.sections, h("span", { text: String(Array.isArray(p.sections) ? p.sections.length : 0) })));
    else if (k === "hull") g.push(row(T.points, h("span", { text: String(Array.isArray(p.points) ? p.points.length : 0) })));
    else if (k === "mesh") { g.push(row(T.points, h("span", { text: String(Array.isArray(p.v) ? p.v.length : 0) }))); g.push(row(T.faces, h("span", { text: String(Array.isArray(p.f) ? p.f.length : 0) }))); }
    else if (k === "file") {
      g.push(row(T.src, h("span", { text: String(p.src || ""), title: String(p.src || "") })));
      g.push(row(T.fitBox, vecInput(p.fit, 3, function (a) { edit(function () { setKey(p, "fit", a.every(function (x) { return x === 0 || x === ""; }) ? undefined : a); }); }, { k: "fit", label: T.fitBox })));
      g.push(row(T.unit, selectInput(p.unit || "", [["", "auto"], ["mm", "mm"], ["cm", "cm"], ["m", "m"], ["in", "in"]], function (v) { edit(function () { setKey(p, "unit", v || undefined); }); }, "unit")));
    }
    else if (k === "group") g.push(row(T.parts, h("span", { text: String(Array.isArray(p.parts) ? p.parts.length : 0) })));
    else if (k === "ref") {
      var ids = Object.keys(allIds()).filter(function (x) { return x !== p.id; });
      g.push(row(T.of, selectInput(p.of, ids.map(function (x) { return [x, x]; }), set("of"), "of")));
    }
    if (g.length) out.appendChild(section(T.geometry, g));
    // placement
    var sc = p.scale, uniform = !Array.isArray(sc);
    out.appendChild(section(T.placement, [
      row(T.at, vecInput(p.at, 3, function (a) { edit(function () { setKey(p, "at", a); }); }, { k: "at", label: T.at })),
      row(T.rot + " \u00b0", vecInput(p.rot, 3, function (a) { edit(function () { setKey(p, "rot", a.every(function (x) { return x === 0; }) ? undefined : a); }); }, { k: "rot", label: T.rot })),
      row(T.scl, uniform ? exprInput(sc, function (v) { edit(function () { setKey(p, "scale", v === 1 ? undefined : v); }); }, { k: "scale", optional: true, ph: "1", label: T.scl })
        : vecInput(sc, 3, function (a) { edit(function () { setKey(p, "scale", a); }); }, { k: "scale", fill: 1, label: T.scl }))
    ]));
    out.appendChild(matSection(p));
    out.appendChild(arraySection(p));
    out.appendChild(section(T.mirror, [row(T.mirror, selectInput(p.mirror || "", [["", T.none], ["x", "X"], ["y", "Y"], ["z", "Z"]], function (v) { edit(function () { setKey(p, "mirror", v || undefined); }); }, "mirror"))]));
    var mine = probs.filter(function (x) { return x.part === p.id; });
    if (mine.length) out.appendChild(section(T.problems, mine.slice(0, 10).map(probRow)));
    out.appendChild(jsonSection(f));
    return out;
  }
  function profileRows(g, p, key) {
    var pr = p[key];
    if (isObj(pr)) {
      var kind = Object.keys(PROFILE).filter(function (x) { return Array.isArray(pr[x]); })[0];
      if (kind) {
        g.push(row(T.profile, h("span", { text: kind + " (" + PROFILE[kind].join(", ") + ")" })));
        g.push(h("div", { "class": "md-row" }, [h("span"), vecInput(pr[kind], PROFILE[kind].length, function (a) {
          edit(function () { pr[kind] = a; });
        }, { k: key + "-" + kind, ph: PROFILE[kind], label: kind })]));
        return;
      }
      if (Array.isArray(pr.points)) {
        g.push(row(T.profile, h("span", { text: pr.points.length + " " + T.points })));
        g.push(row(T.fillet, exprInput(pr.fillet, function (v) { edit(function () { setKey(pr, "fillet", v); }); }, { k: key + "-fillet", optional: true })));
        return;
      }
    }
    g.push(row(T.profile, h("span", { text: (Array.isArray(pr) ? pr.length : 0) + " " + T.points })));
  }
  function hex6(c) {
    if (isNum(c)) return "#" + ("00000" + (c & 0xffffff).toString(16)).slice(-6);
    if (typeof c !== "string") return null;
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map(function (x) { return x + x; }).join("").toLowerCase();
    return null;
  }
  function presetOf(name) { var ps = MK && MK.PRESETS || {}; var p = ps[name]; return isObj(p) ? p : null; }
  /** What a part's mat means: a material of the model, a preset, an inline colour or none. */
  function matInfo(mat) {
    var mats = isObj(model.materials) ? model.materials : {}, o = { kind: "none", name: "", color: "#b4b4b4", metal: 0, rough: 0.6, opacity: 1 };
    var fill = function (spec) {
      if (!isObj(spec)) return;
      o.color = hex6(spec.color) || o.color;
      ["metal", "rough", "opacity"].forEach(function (k) { if (isNum(spec[k])) o[k] = spec[k]; });
    };
    if (typeof mat !== "string" || !mat) return o;
    if (Object.prototype.hasOwnProperty.call(mats, mat)) {
      o.kind = "named"; o.name = mat;
      var m = mats[mat];
      if (typeof m === "string") fill(presetOf(m)); else fill(m);
      return o;
    }
    if (presetOf(mat)) { o.kind = "preset"; o.name = mat; fill(presetOf(mat)); return o; }
    if (hex6(mat)) { o.kind = "hex"; o.color = hex6(mat); return o; }
    return o;
  }
  function matSection(p) {
    var info = matInfo(p.mat), mats = isObj(model.materials) ? Object.keys(model.materials) : [], presets = Object.keys(MK && MK.PRESETS || {});
    var opts = [["", T.defMat]];
    if (mats.length) opts.push({ group: T.modelMats, items: mats.map(function (x) { return [x, x]; }) });
    if (presets.length) opts.push({ group: T.presets, items: presets.map(function (x) { return [x, x]; }) });
    if (info.kind === "hex") opts.push([p.mat, T.custom + " " + info.color]);
    else if (typeof p.mat === "string" && p.mat && info.kind === "none") opts.push([p.mat, p.mat]);
    var pick = selectInput(typeof p.mat === "string" ? p.mat : "", opts, function (v) { edit(function () { setKey(p, "mat", v || undefined); }); }, "mat");
    var col = h("input", { type: "color", value: info.color, "aria-label": T.color, "data-k": "mat-color", disabled: !editable() });
    col.addEventListener("change", function () { setMat(p, "color", col.value); });
    var rows = [row(T.mat, pick), row(T.color, h("span", { "class": "md-color" }, [col, h("span", { "class": "md-ev", text: col.value })]))];
    [["metal", T.metal], ["rough", T.rough], ["opacity", T.opacity]].forEach(function (x) {
      var r = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: info[x[0]], "aria-label": x[1], "data-k": "mat-" + x[0], disabled: !editable() });
      var out = h("span", { "class": "md-ev", text: fmt(info[x[0]], 2) });
      r.addEventListener("input", function () { out.textContent = fmt(+r.value, 2); });
      r.addEventListener("change", function () { setMat(p, x[0], round(+r.value, 2)); });
      rows.push(row(x[1], h("span", { "class": "md-range" }, [r, out])));
    });
    if (info.kind === "named") {
      var n = 0; walk(parts(), null, function (x) { if (x.mat === info.name) n++; });
      rows.push(h("div", { "class": "md-hint", text: T.sharedMat(info.name, n) }));
    }
    return section(T.mat, rows);
  }
  /** A colour or a slider changed: a model material is edited in place; otherwise a colour alone becomes
   *  an inline "#rrggbb", and metal/rough/opacity make a named material for this part. */
  function setMat(p, key, v) {
    edit(function () {
      var info = matInfo(p.mat);
      if (info.kind === "named") {
        var m = model.materials[info.name];
        if (!isObj(m)) m = model.materials[info.name] = { color: info.color, metal: info.metal, rough: info.rough, opacity: info.opacity };
        m[key] = v;
        return;
      }
      if (key === "color" && (info.kind === "hex" || info.kind === "none")) { p.mat = v; return; }
      model.materials = isObj(model.materials) ? model.materials : {};
      var base = String(p.id || "mat").replace(/[^A-Za-z0-9_-]/g, "") || "mat", name = base, i = 1;
      while (Object.prototype.hasOwnProperty.call(model.materials, name)) name = base + "-" + (++i);
      var spec = { color: info.color, metal: round(info.metal, 2), rough: round(info.rough, 2), opacity: round(info.opacity, 2) };
      spec[key] = v;
      model.materials[name] = spec;
      p.mat = name;
    });
  }
  function arraySection(p) {
    var a = isObj(p.array) ? p.array : null, kind = !a ? "" : a.grid ? "grid" : a.radial != null ? "radial" : "linear";
    var step = function () { var o = built && built.byId[p.id]; if (o && THREE) { var b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) return round(Math.max(b.max.x - b.min.x, 1) * 1.25, 0); } return 100; };
    var rows = [row(T.array, selectInput(kind, [["", T.none], ["linear", T.arrLinear], ["grid", T.arrGrid], ["radial", T.arrRadial]], function (v) {
      edit(function () {
        var s = step();
        setKey(p, "array", v === "linear" ? { n: 3, d: [s, 0, 0] } : v === "grid" ? { grid: [3, 2], d: [s, s] } : v === "radial" ? { radial: 6, axis: "z", angle: 360 } : undefined);
      });
    }, "array"))];
    var setA = function (key) { return function (v) { edit(function () { setKey(a, key, v); }); }; };
    if (kind === "linear") {
      rows.push(row(T.count, exprInput(a.n, setA("n"), { k: "arr-n", int: true })));
      rows.push(row(T.spacing, vecInput(a.d, 3, setA("d"), { k: "arr-d" })));
    } else if (kind === "grid") {
      rows.push(row(T.count, vecInput(a.grid, 2, setA("grid"), { k: "arr-g", fill: 1 })));
      rows.push(row(T.spacing, vecInput(a.d, 2, setA("d"), { k: "arr-gd" })));
    } else if (kind === "radial") {
      rows.push(row(T.count, exprInput(a.radial, setA("radial"), { k: "arr-r", int: true })));
      rows.push(row(T.axis, selectInput(a.axis || "z", [["x", "X"], ["y", "Y"], ["z", "Z"]], setA("axis"), "arr-ax")));
      rows.push(row(T.angle, exprInput(a.angle, setA("angle"), { k: "arr-an", optional: true, ph: "360" })));
      rows.push(row(T.center, vecInput(a.center, 3, setA("center"), { k: "arr-c" })));
    }
    return section(T.array, rows);
  }
  function jsonSection(f) {
    var ta = h("textarea", { spellcheck: "false", "aria-label": T.json, disabled: !editable() });
    ta.value = ser(f.part, "");
    ta.addEventListener("keydown", function (e) { e.stopPropagation(); });
    var msg = h("div", { "class": "md-hint md-bad" });
    var ok = btn(null, T.apply, function () {
      var v;
      try { v = JSON.parse(ta.value); } catch (e) { msg.textContent = T.badJson + ": " + errText(e); return; }
      if (!isObj(v) || typeof v.kind !== "string" || typeof v.id !== "string") { msg.textContent = T.badJson; return; }
      var oldId = f.part.id;
      if (v.id !== oldId && allIds()[v.id]) { msg.textContent = "id " + v.id + " exists"; return; }
      edit(function () { var g = find(oldId); if (g) g.list[g.i] = v; sel = [v.id]; });
    }, "md-wide");
    ok.textContent = T.apply; ok.disabled = !editable();
    return h("section", { "class": "md-sec" }, [h("details", {}, [h("summary", { text: T.json }), ta, msg, ok])]);
  }

  // Outline
  function probRow(x) {
    var b = h("button", { type: "button", "class": "md-prob" }, [h("code", { text: String(x.path || x.part || "") }), document.createTextNode(" " + String(x.msg || "").slice(0, 300))]);
    b.addEventListener("click", function () { if (x.part && find(x.part)) { setSel([x.part]); focusSel(); } });
    return b;
  }
  function outlinePanel() {
    var out = h("div", { "class": "md-pbody", role: "tabpanel" }), tree = h("div", { "class": "md-tree", role: "tree" });
    if (!parts().length) tree.appendChild(note(T.empty));
    var count = 0;
    (function rows(list, depth) {
      list.forEach(function (p) {
        if (!isObj(p) || count > 2000) return;
        count++;
        var isG = p.kind === "group" && Array.isArray(p.parts) && p.parts.length, open = !collapsed[p.id];
        var hidden = !!p.hidden || !!localHidden[p.id] || (p.tag && layerOff[p.tag]);
        var caret = h("span", { "class": "md-ocaret", html: isG ? kit.icon(open ? "caretDown" : "caretRight") : "" });
        var eye = h("span", { "class": "md-oeye", role: "button", title: hidden ? T.show : T.hide, html: icon(hidden ? "eyeOff" : "eye") });
        var r = h("button", { type: "button", role: "treeitem", "class": "md-orow" + (sel.indexOf(p.id) >= 0 ? " is-on" : "") + (hidden ? " is-off" : ""),
          style: "padding-left:" + (4 + depth * 14) + "px", "data-id": p.id },
          [caret, eye, h("b", { text: label(p) }), h("span", { "class": "md-okind", text: T.kinds[p.kind] || p.kind || "" })].concat(badParts[p.id] ? [h("span", { "class": "md-obad", title: T.problems })] : []));
        caret.addEventListener("click", function (e) { if (!isG) return; e.stopPropagation(); collapsed[p.id] = open; renderPanel(); });
        eye.addEventListener("click", function (e) { e.stopPropagation(); toggleHidden([p.id]); });
        r.addEventListener("click", function (e) { pickId(p.id, e.shiftKey || e.ctrlKey || e.metaKey); });
        r.addEventListener("dblclick", function () { setSel([p.id]); focusSel(); });
        tree.appendChild(r);
        if (isG && open) rows(p.parts, depth + 1);
      });
    })(parts(), 0);
    out.appendChild(tree);
    var tags = {}, untagged = 0;
    walk(parts(), null, function (p) { if (typeof p.tag === "string" && p.tag) tags[p.tag] = (tags[p.tag] || 0) + 1; else untagged++; });
    var tl = Object.keys(tags).sort();
    if (tl.length) out.appendChild(section(T.layers, tl.map(function (t) {
      var c = h("input", { type: "checkbox" }); c.checked = !layerOff[t];
      c.addEventListener("change", function () { if (c.checked) delete layerOff[t]; else layerOff[t] = 1; applyVisibility(); renderPanel(); sendView(); invalidate(); });
      return h("label", { "class": "md-layer" }, [c, h("span", { text: t }), h("span", { text: String(tags[t]) })]);
    })));
    out.appendChild(section(T.problems, probs.length ? probs.slice(0, 200).map(probRow) : [h("div", { "class": "md-hint", text: T.noProblems })]));
    return out;
  }
  function pickId(id, add) {
    if (add) setSel(sel.indexOf(id) >= 0 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]), true);
    else setSel([id], true);
  }

  // ------------------------------------------------------------------ three setup
  var THREE = null, renderer = null, canvas = null, scene = null, persp = null, ortho = null, camera = null, controls = null, tc = null, tcHelper = null;
  var pivot = null, labels = null, helpers = null, gridScene = null, gridGrp = null, dimsGrp = null, measGrp = null, secGrp = null, lineMats = [];
  var viewW = 1, viewH = 1, orthoH = 1000, sphere = null, TH = {};
  function loadThree() {
    if (window.THREE && window.THREE.WebGLRenderer) return Promise.resolve(window.THREE);
    if (!window.hermes || !window.hermes.vendor) return Promise.reject(new Error(T.noLib));
    return window.hermes.vendor("three.bundle.js").then(function (src) {
      (0, eval)(src + "\n//# sourceURL=vendor/three.bundle.js");
      if (!window.THREE || !window.THREE.WebGLRenderer) throw new Error(T.noLib);
      return window.THREE;
    });
  }
  function initGL() {
    THREE = window.THREE;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      if (!renderer.getContext()) return false;
    } catch (e) { renderer = null; return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.NeutralToneMapping != null ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    canvas = renderer.domElement;
    canvas.className = "md-canvas"; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "3D");
    viewEl.insertBefore(canvas, viewEl.firstChild);
    scene = new THREE.Scene();
    scene.environment = makeEnv();
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.85;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-1.2, -2, 3); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(2, 1.5, 0.8); scene.add(fill);
    persp = new THREE.PerspectiveCamera(40, 1, 1, 1e6);
    ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);
    camera = persp;
    camera.position.set(3000, -4000, 2500);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.14;
    controls.screenSpacePanning = true; controls.zoomToCursor = true;
    controls.rotateSpeed = 0.8; controls.minDistance = 0.5; controls.maxDistance = 5e6;
    controls.addEventListener("change", invalidate);
    controls.addEventListener("start", function () { interacting = true; tipEl.hidden = true; invalidate(); });
    controls.addEventListener("end", function () { interacting = false; invalidate(); });
    helpers = new THREE.Group(); helpers.name = "md-helpers"; scene.add(helpers);
    // the grid is drawn in a pass of its own before the model, then the depth is cleared: parts always cover it
    gridScene = new THREE.Scene(); gridGrp = new THREE.Group(); gridScene.add(gridGrp);
    renderer.autoClear = false;
    dimsGrp = new THREE.Group(); measGrp = new THREE.Group(); secGrp = new THREE.Group();
    helpers.add(dimsGrp, measGrp, secGrp);
    pivot = new THREE.Object3D(); scene.add(pivot);
    tc = new THREE.TransformControls(camera, canvas);
    tc.setSize(0.85);
    tcHelper = tc.getHelper ? tc.getHelper() : tc;
    scene.add(tcHelper);
    tc.addEventListener("change", invalidate);
    tc.addEventListener("dragging-changed", function (e) { controls.enabled = !e.value; if (e.value) dragStart(); else dragEnd(); });
    tc.addEventListener("objectChange", dragMove);
    applySnap();
    labels = new THREE.CSS2DRenderer();
    labels.domElement.className = "md-labels";
    viewEl.insertBefore(labels.domElement, canvas.nextSibling);
    themeColors();
    new ResizeObserver(resize).observe(viewEl);
    resize();
    bindPointer();
    return true;
  }
  /** Image-based light without files: a soft studio (grey gradient dome, an overhead softbox, a key and a
   *  rim panel) rendered once through PMREM, so metals have something to reflect. */
  function makeEnv() {
    var pm = new THREE.PMREMGenerator(renderer), s = new THREE.Scene(), trash = [];
    var geo = new THREE.SphereGeometry(50, 48, 24), pos = geo.attributes.position, col = [];
    for (var i = 0; i < pos.count; i++) {
      var z = pos.getZ(i) / 50, c = z < 0 ? 0.16 + 0.3 * (1 + z) : 0.46 + 0.42 * z;
      col.push(c, c, c * 1.02);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    var dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    s.add(dome); trash.push(dome);
    function panel(w, hh, x, y, z, k) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); trash.push(m);
    }
    panel(46, 46, 0, 0.5, 44, 2.6);
    panel(24, 34, -36, -30, 14, 4.5);
    panel(16, 30, 38, 28, 10, 2.2);
    panel(60, 6, 0, 46, 2, 1.4);
    var rt = pm.fromScene(s, 0.035);
    trash.forEach(function (m) { m.geometry.dispose(); m.material.dispose(); });
    pm.dispose();
    return rt.texture;
  }
  // theme: colours for the grid, the dimension lines and the measure line, from Hermes' CSS variables
  var probe = h("span", { style: "display:none" });
  document.body.appendChild(probe);
  function cssColor(name, fallback) {
    probe.style.color = ""; probe.style.color = "var(" + name + ")";
    var s = getComputedStyle(probe).color || "", m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s), c = new THREE.Color(fallback);
    if (m) c.setRGB(+m[1], +m[2], +m[3], THREE.SRGBColorSpace);
    else if ((m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s))) c.setRGB(m[1] / 255, m[2] / 255, m[3] / 255, THREE.SRGBColorSpace);
    return c;
  }
  function themeColors() {
    if (!THREE) return;
    TH = { fg: cssColor("--color-fg", 0x0f1720), fg2: cssColor("--color-fg-secondary", 0x334155), bg: cssColor("--color-bg", 0xf5f7fa), accent: cssColor("--color-accent", 0x0d9488) };
    TH.dark = TH.bg.getHSL({}).l < 0.4;
    if (gridGrp && bbox) { gridKey = ""; updateGrid(); }
    drawDims(); drawMeasure(); drawSectionOutline(); paint();
    invalidate();
  }
  kit.hostTheme(function () { setTimeout(themeColors, 0); });
  new MutationObserver(function () { themeColors(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
  if (window.matchMedia) { var mq = window.matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", themeColors); }

  // render on demand: a frame when something changed, frames while orbiting, damping or animating
  var raf = 0, need = false, inFrame = false, interacting = false, anim = null;
  function invalidate() { need = true; if (!raf && !inFrame && renderer) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0; inFrame = true;
    var keep = false;
    if (anim) keep = stepAnim(now) || keep;
    if (controls && controls.update()) { need = true; keep = true; }
    if (need) { need = false; render(); }
    inFrame = false;
    if (keep || interacting || need) raf = requestAnimationFrame(frame);
  }
  function render() {
    if (!renderer) return;
    updateClipRange();
    draw(true);
    labels.render(scene, camera);
    drawAxes();
  }
  function draw(grid) {
    renderer.clear();
    if (grid && gridGrp.visible) { renderer.render(gridScene, camera); renderer.clearDepth(); }
    renderer.render(scene, camera);
  }
  function resize() {
    if (!renderer) return;
    viewW = Math.max(1, viewEl.clientWidth); viewH = Math.max(1, viewEl.clientHeight);
    renderer.setSize(viewW, viewH);
    labels.setSize(viewW, viewH);
    setAspect(viewW / viewH);
    lineMats.forEach(function (m) { m.resolution.set(viewW, viewH); });
    invalidate();
  }
  function setAspect(a) {
    persp.aspect = a; persp.updateProjectionMatrix();
    ortho.top = orthoH / 2; ortho.bottom = -orthoH / 2; ortho.left = -orthoH / 2 * a; ortho.right = orthoH / 2 * a;
    ortho.updateProjectionMatrix();
  }
  /** near/far hugging the scene's sphere (the model and the grid), for depth precision at any scale. */
  function updateClipRange() {
    if (!sphere) return;
    var dc = camera.position.distanceTo(sphere.center), r = sphere.radius * 1.05 + 1;
    if (camera.isPerspectiveCamera) { camera.near = Math.max(dc - r, (dc + r) * 2e-5, 0.01); camera.far = dc + r; }
    else { camera.near = dc - r; camera.far = dc + r; }
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ build glue
  var building = false, buildAgain = false, firstBuild = true, buildRaf = 0, pendingPlace = null, pendingSel = null;
  var firstDone = false; // the first build is on screen (or failed): the host's ready
  function firstShown() { if (!firstDone) { firstDone = true; kit.ready(); } }
  function requestBuild() { if (!buildRaf) buildRaf = requestAnimationFrame(function () { buildRaf = 0; rebuild(); }); }
  function rebuild() {
    if (!glOK || !MK) { collectProblems(); return; }
    if (building) { buildAgain = true; return; }
    building = true; buildAgain = false;
    var vals = Object.keys(live).length ? Object.assign({}, live) : undefined;
    Promise.resolve().then(function () { return MK.build(model, { files: C.files, values: vals }); })
      .then(swap, function (e) { collectProblems([{ path: "model", msg: errText(e) }]); if (!sliding) renderPanel(); })
      .then(function () { building = false; firstShown(); if (buildAgain) rebuild(); }, function (e) { building = false; firstShown(); console.error(e); });
  }
  function collectProblems(extra) {
    var list = [], seen = {};
    var add = function (x) {
      if (!x) return;
      var k = (x.part || "") + "|" + (x.path || "") + "|" + (x.msg || "");
      if (seen[k]) return; seen[k] = 1; list.push(x);
    };
    if (MK) { try { (MK.validate(model, C.files) || []).forEach(add); } catch (e) { add({ path: "model", msg: errText(e) }); } }
    (P.problems || []).forEach(add);
    if (built && built.problems) built.problems.forEach(add);
    (extra || []).forEach(add);
    probs = list;
    badParts = {};
    probs.forEach(function (x) { if (x.part) badParts[x.part] = 1; });
  }
  function normBox(bb) {
    if (!bb || !bb.min || !bb.max) return null;
    var v = function (a) { return Array.isArray(a) ? new THREE.Vector3(+a[0], +a[1], +a[2]) : new THREE.Vector3(+a.x, +a.y, +a.z); };
    var b = new THREE.Box3(v(bb.min), v(bb.max));
    return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(isFinite) && !b.isEmpty() ? b : null;
  }
  var ownEdges = [];
  function swap(b) {
    if (!b || !b.root) return;
    restoreAll(); removeCaps();
    if (built) {
      scene.remove(built.root);
      ownEdges.forEach(function (e) { e.geometry.dispose(); }); ownEdges = [];
      try { MK.dispose(built); } catch (e) { console.warn(e); }
    }
    built = b; root = b.root;
    scene.add(root);
    ensureEdges();
    root.updateMatrixWorld(true);
    bbox = normBox(b.stats && b.stats.bbox) || new THREE.Box3().setFromObject(root);
    if (bbox.isEmpty()) bbox = null;
    var ids = allIds();
    sel = sel.filter(function (id) { return ids[id]; });
    if (hover && !ids[hover]) hover = null;
    collectProblems();
    if (pendingPlace && placeImported()) return;
    if (pendingSel) { sel = pendingSel.filter(function (id) { return ids[id]; }); pendingSel = null; }
    applyVisibility(); applyClip(); paint(); updateGrid(); drawDims(); drawSection();
    if (!drag) attachGizmo();
    if (firstBuild) { firstBuild = false; startView(); msgEl.hidden = !!parts().length; if (!parts().length) msgEl.replaceChildren(h("div", { text: T.empty })); firstPreview(); }
    else msgEl.hidden = true;
    if (pendingFit) { pendingFit = false; fitAll(true); }
    if (!sliding) renderPanel();
    drawSelPill(); sendView(); invalidate();
  }
  /** Crisp edges come from the builder; a builder that drew none gets them here (plain meshes only). */
  function ensureEdges() {
    var has = false, list = [];
    root.traverse(function (o) { if (o.isLineSegments || o.isLine || o.isLineSegments2) has = true; if (o.isMesh && !o.isInstancedMesh) list.push(o); });
    if (has) return;
    var mat = new THREE.LineBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.55 });
    list.forEach(function (o) {
      var id = partOf(o), f = id && find(id);
      if (f && f.part.edges === false) return;
      var e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), mat);
      o.add(e); ownEdges.push(e);
    });
  }
  function applyVisibility() {
    if (!built) return;
    Object.keys(built.byId || {}).forEach(function (id) {
      var o = built.byId[id], f = find(id);
      if (!o || !f) return;
      o.visible = !f.part.hidden && !localHidden[id] && !(f.part.tag && layerOff[f.part.tag]);
    });
  }
  function partOf(o) { while (o) { if (o.userData && o.userData.partId != null) return String(o.userData.partId); o = o.parent; } return null; }
  function visibleChain(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

  // ------------------------------------------------------------------ grid and axes
  var gridKey = "";
  function updateGrid() {
    if (!gridGrp) return;
    var b = bbox || new THREE.Box3(new THREE.Vector3(-500, -500, 0), new THREE.Vector3(500, 500, 500));
    var size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, (b.max.z - b.min.z) * 0.5, 1);
    var minor = Math.pow(10, Math.floor(Math.log10(size / 10))), major = minor * 10;
    var half = Math.max(2, Math.ceil(size * 0.9 / major + 0.5)) * major;
    var cx = Math.round((b.min.x + b.max.x) / 2 / major) * major, cy = Math.round((b.min.y + b.max.y) / 2 / major) * major;
    var z = Math.min(0, b.min.z) - minor * 0.01;
    var key = [minor, half, cx, cy, z].join(",");
    var all = new THREE.Box3(new THREE.Vector3(cx - half, cy - half, z), new THREE.Vector3(cx + half, cy + half, z)).union(b);
    sphere = all.getBoundingSphere(new THREE.Sphere());
    if (key === gridKey) return;
    gridKey = key;
    gridGrp.children.slice().forEach(function (c) { gridGrp.remove(c); c.geometry.dispose(); c.material.dispose(); });
    var lines = { minor: [], major: [], x: [], y: [] };
    var n = Math.round(half / minor);
    for (var i = -n; i <= n; i++) {
      var v = i * minor, isMajor = i % 10 === 0, isAxisX = cy + v === 0, isAxisY = cx + v === 0;
      (isAxisX ? lines.x : isMajor ? lines.major : lines.minor).push(cx - half, cy + v, z, cx + half, cy + v, z);
      (isAxisY ? lines.y : isMajor ? lines.major : lines.minor).push(cx + v, cy - half, z, cx + v, cy + half, z);
    }
    var mk = function (arr, color, op) {
      if (!arr.length) return;
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      var l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: op, depthWrite: false, toneMapped: false }));
      l.raycast = function () {}; l.renderOrder = -1;
      gridGrp.add(l);
    };
    mk(lines.minor, TH.fg, TH.dark ? 0.07 : 0.06);
    mk(lines.major, TH.fg, TH.dark ? 0.15 : 0.13);
    mk(lines.x, 0xe5484d, 0.55);
    mk(lines.y, 0x46a758, 0.55);
  }
  var AXES = [["x", 1, 0, 0, "#e5484d"], ["y", 0, 1, 0, "#46a758"], ["z", 0, 0, 1, "#3e63dd"]];
  function drawAxes() {
    var q = camera.quaternion.clone().invert(), items = [];
    AXES.forEach(function (a) {
      [1, -1].forEach(function (s) {
        var v = new THREE.Vector3(a[1] * s, a[2] * s, a[3] * s).applyQuaternion(q);
        items.push({ name: a[0], s: s, x: v.x * 26, y: -v.y * 26, z: v.z, color: a[4] });
      });
    });
    items.sort(function (a, b) { return a.z - b.z; });
    var out = "";
    items.forEach(function (it) {
      if (it.s > 0) out += '<line x1="0" y1="0" x2="' + it.x.toFixed(1) + '" y2="' + it.y.toFixed(1) + '" stroke="' + it.color + '" stroke-width="2"/>';
      out += '<g class="md-ax' + (it.s < 0 ? " md-ax-neg" : "") + '" data-ax="' + it.name + it.s + '"><circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="' + (it.s > 0 ? 8 : 5.5) +
        '" fill="' + it.color + '"/>' + (it.s > 0 ? '<text x="' + it.x.toFixed(1) + '" y="' + it.y.toFixed(1) + '">' + it.name.toUpperCase() + "</text>" : "") + "</g>";
    });
    axesEl.innerHTML = out;
  }
  axesEl.addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest("[data-ax]");
    if (!g) return;
    var a = g.getAttribute("data-ax"), s = a.slice(1) === "1" ? 1 : -1, d = { x: [s, 0, 0], y: [0, s, 0], z: [0, s * -0.001, s] }[a[0]];
    viewDir(new THREE.Vector3(d[0], d[1], d[2]));
  });

  // ------------------------------------------------------------------ camera and views
  function sceneBox() { return bbox ? bbox.clone() : new THREE.Box3(new THREE.Vector3(-500, -500, 0), new THREE.Vector3(500, 500, 500)); }
  /** The camera placement that frames box from direction dir. */
  function framing(box, dir) {
    var sp = box.getBoundingSphere(new THREE.Sphere()), r = Math.max(sp.radius, 1), a = viewW / viewH;
    var vf = persp.fov * DEG / 2, f = Math.min(vf, Math.atan(Math.tan(vf) * a));
    var dist = r / Math.sin(f) * 1.04;
    return { pos: sp.center.clone().addScaledVector(dir.clone().normalize(), dist), target: sp.center.clone(), h: 2 * r * 1.08 / Math.min(1, a) };
  }
  function curDir() { return camera.position.clone().sub(controls.target).normalize(); }
  function goTo(to, animate) {
    if (!camera) return;
    var from = { pos: camera.position.clone(), target: controls.target.clone(), h: camera.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom : 0 };
    if (!animate || window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { anim = { from: from, to: to, t0: -1e9, dur: 1 }; stepAnim(0); invalidate(); return; }
    anim = { from: from, to: to, t0: performance.now(), dur: 380 };
    invalidate();
  }
  function stepAnim(now) {
    var a = anim, t = clamp((now - a.t0) / a.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    var d0 = a.from.pos.clone().sub(a.from.target), d1 = a.to.pos.clone().sub(a.to.target), l0 = d0.length() || 1, l1 = d1.length() || 1;
    var q = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d1.clone().normalize()), qi = new THREE.Quaternion().slerp(q, e);
    var tg = a.from.target.clone().lerp(a.to.target, e);
    var dir = d0.normalize().applyQuaternion(qi);
    controls.target.copy(tg);
    camera.position.copy(tg).addScaledVector(dir, l0 + (l1 - l0) * e);
    if (camera.isOrthographicCamera && a.to.h) {
      var hh = (a.from.h || a.to.h) + (a.to.h - (a.from.h || a.to.h)) * e;
      orthoH = hh; ortho.zoom = 1; setAspect(viewW / viewH);
    }
    camera.lookAt(tg);
    controls.update();
    need = true;
    if (t >= 1) { anim = null; sendView(); return false; }
    return true;
  }
  function viewDir(dir, box) { goTo(framing(box || sceneBox(), dir), true); }
  function setView(name) { if (VIEWS[name]) viewDir(new THREE.Vector3(VIEWS[name][0], VIEWS[name][1], VIEWS[name][2])); }
  function namedView(v) {
    var c = ev3(v.cam, NaN), t = ev3(v.target, 0);
    if (!c.every(isFinite)) return;
    setOrtho(!!v.ortho);
    var pos = new THREE.Vector3(c[0], c[1], c[2]), tg = new THREE.Vector3(t[0], t[1], t[2]);
    var fr = framing(sceneBox(), pos.clone().sub(tg));
    goTo({ pos: pos, target: tg, h: v.ortho ? fr.h : 0 }, true);
    drawChrome();
  }
  function fitAll(animate) { if (camera) goTo(framing(sceneBox(), curDir()), animate); }
  function selBox() {
    var b = new THREE.Box3();
    sel.forEach(function (id) { var o = built && built.byId[id]; if (o) b.union(new THREE.Box3().setFromObject(o)); });
    return b.isEmpty() ? null : b;
  }
  function focusSel() { if (!camera) return; var b = selBox(); if (!b) return fitAll(true); goTo(framing(b, curDir()), true); }
  function startView() {
    var v = views()[0];
    if (v) { namedView(v); anim && (anim.dur = 1); return; }
    goTo(framing(sceneBox(), new THREE.Vector3(VIEWS.iso[0], VIEWS.iso[1], VIEWS.iso[2])), false);
  }
  /** Perspective <-> orthographic, keeping what is framed at the target's distance. */
  function setOrtho(on) {
    if (!camera || on === !!camera.isOrthographicCamera) return;
    var d = camera.position.distanceTo(controls.target), dir = curDir();
    if (on) {
      orthoH = 2 * d * Math.tan(persp.fov * DEG / 2);
      ortho.position.copy(camera.position); ortho.quaternion.copy(camera.quaternion); ortho.zoom = 1;
      camera = ortho;
    } else {
      var vis = (ortho.top - ortho.bottom) / ortho.zoom, nd = vis / 2 / Math.tan(persp.fov * DEG / 2);
      persp.position.copy(controls.target).addScaledVector(dir, nd); persp.quaternion.copy(ortho.quaternion);
      camera = persp;
    }
    setAspect(viewW / viewH);
    controls.object = camera; tc.camera = camera;
    camera.lookAt(controls.target);
    controls.update();
    invalidate(); sendView();
  }

  // ------------------------------------------------------------------ selection, hover and the look of both
  var tinted = [];
  function setSel(ids, fromPanel) {
    sel = ids.filter(function (id, i) { return ids.indexOf(id) === i && find(id); });
    paint(); attachGizmo();
    if (sel.length && !fromPanel && tab !== "outline") tab = "props";
    renderPanel(); drawSelPill(); sendView(); invalidate();
  }
  function restoreAll() {
    tinted.forEach(function (o) {
      var cur = o.material;
      (Array.isArray(cur) ? cur : [cur]).forEach(function (m) { m.dispose(); });
      o.material = o.userData.mdOrig; delete o.userData.mdOrig;
    });
    tinted = [];
  }
  /** Selected parts glow faintly in Hermes' accent and their edges take it; a hovered one glows less. */
  function paint() {
    if (!built || !THREE || !TH.accent) return;
    restoreAll();
    var tint = function (obj, k) {
      obj.traverse(function (o) {
        if (o.userData.mdCap || o.userData.mdOrig || !o.material) return;
        if (o.isMesh) {
          var cl = function (m) {
            var c = m.clone();
            c.clippingPlanes = sec.on ? clipList : null; // clone() copies the planes; the section moves the shared ones
            if (c.emissive) { c.emissive = TH.accent.clone(); c.emissiveIntensity = k === "sel" ? 0.32 : 0.14; }
            else if (c.color) c.color.lerp(TH.accent, k === "sel" ? 0.4 : 0.2);
            return c;
          };
          o.userData.mdOrig = o.material;
          o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
          tinted.push(o);
        } else if ((o.isLineSegments || o.isLine || o.isLineSegments2) && k === "sel") {
          o.userData.mdOrig = o.material;
          var lm = o.material.clone(); lm.clippingPlanes = sec.on ? clipList : null; if (lm.color) lm.color = TH.accent.clone(); if ("opacity" in lm) lm.opacity = 1;
          o.material = lm; tinted.push(o);
        }
      });
    };
    sel.forEach(function (id) { var o = built.byId[id]; if (o) tint(o, "sel"); });
    if (hover && sel.indexOf(hover) < 0 && built.byId[hover]) tint(built.byId[hover], "hover");
    invalidate();
  }

  // pointer: click to select (shift adds), hover, double-click to focus; measure clicks
  var ray = null, ndc = null, down = null, hoverRaf = 0, lastMove = null;
  function bindPointer() {
    ray = new THREE.Raycaster(); ndc = new THREE.Vector2();
    canvas.addEventListener("pointerdown", function (e) {
      down = { x: e.clientX, y: e.clientY, b: e.button, gizmo: !!(tc && tc.enabled && tc.object && tc.axis != null) };
      if (inField(document.activeElement)) document.activeElement.blur(); // the page's keys work again
    });
    canvas.addEventListener("pointerup", function (e) {
      var d = down; down = null;
      if (!d || d.b !== 0 || d.gizmo || (tc && tc.dragging)) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) return;
      click(e);
    });
    canvas.addEventListener("pointermove", function (e) {
      lastMove = e;
      if (e.pointerType === "touch" || e.buttons) { tipEl.hidden = true; return; }
      if (!hoverRaf) hoverRaf = requestAnimationFrame(function () { hoverRaf = 0; doHover(lastMove); });
    });
    canvas.addEventListener("pointerleave", function () { tipEl.hidden = true; setHover(null); });
    canvas.addEventListener("dblclick", function (e) { var p = pick(e.clientX, e.clientY); if (p && tool !== "measure") { setSel([p.id]); focusSel(); } });
  }
  function pick(cx, cy) {
    if (!root || !ray) return null;
    var r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObject(root, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      if (!o.isMesh || o.userData.mdCap || !visibleChain(o)) continue;
      if (sec.on && clipPlane.distanceToPoint(hits[i].point) < 0) continue;
      var id = partOf(o);
      if (id) return { id: id, hit: hits[i] };
    }
    return null;
  }
  function doHover(e) {
    if (!e || (tc && tc.dragging) || interacting) return;
    var p = pick(e.clientX, e.clientY), id = p ? p.id : null;
    viewEl.classList.toggle("is-hover", !!id && tool !== "measure");
    if (id && tool !== "measure") {
      var f = find(id), r = viewEl.getBoundingClientRect();
      tipEl.textContent = label(f && f.part); tipEl.hidden = false;
      tipEl.style.left = (e.clientX - r.left) + "px"; tipEl.style.top = (e.clientY - r.top) + "px";
    } else tipEl.hidden = true;
    setHover(tool === "measure" ? null : id);
  }
  function setHover(id) { if (id === hover) return; hover = id; paint(); }
  function click(e) {
    if (tool === "measure") return measureClick(e);
    var p = pick(e.clientX, e.clientY), add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!p) { if (!add && sel.length) setSel([]); return; }
    if (add) setSel(sel.indexOf(p.id) >= 0 ? sel.filter(function (x) { return x !== p.id; }) : sel.concat([p.id]));
    else setSel([p.id]);
  }

  // ------------------------------------------------------------------ the gizmo: move / rotate / scale, written back in the part's parent frame
  function applySnap() {
    if (!tc) return;
    tc.setTranslationSnap(snap.on ? snap.move : null);
    tc.setRotationSnap(snap.on ? snap.rot * DEG : null);
    tc.setScaleSnap(snap.on ? 0.05 : null);
  }
  function setGizmo(mode) { gizmoMode = mode; if (tool === "measure") setMeasure(false); tool = "select"; attachGizmo(); drawChrome(); }
  function orderOf(id) { var o = built && built.byId[id]; return o && o.rotation && o.rotation.order || "ZYX"; } // rot: X then Y then Z about fixed axes
  function localOf(part, order) {
    var at = ev3(part.at, 0), r = ev3(part.rot, 0), s = scl3(part.scale);
    return new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, order)), new THREE.Vector3(s[0], s[1], s[2]));
  }
  function parentWorld(id) {
    var f = find(id), po = f && f.parent && built && built.byId[f.parent.id];
    var o = po || root;
    o.updateWorldMatrix(true, false);
    return o.matrixWorld.clone();
  }
  function partWorld(id) { var f = find(id); return parentWorld(id).multiply(localOf(f.part, orderOf(id))); }
  function attachGizmo() {
    if (!tc) return;
    var ids = topSel();
    var ok = editable() && ids.length && tool === "select" && gizmoMode && ids.every(function (id) { var o = built && built.byId[id]; return o && visibleChain(o); });
    if (!ok) { if (tc.object) tc.detach(); invalidate(); return; }
    var s = new THREE.Vector3();
    partWorld(ids[0]).decompose(pivot.position, pivot.quaternion, s);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    if (tc.object !== pivot) tc.attach(pivot);
    tc.setMode(gizmoMode);
    tc.setSpace(gizmoMode === "translate" ? "world" : "local");
    invalidate();
  }
  var drag = null;
  function dragStart() {
    pivot.updateMatrixWorld(true);
    drag = { inv0: pivot.matrixWorld.clone().invert(), mode: tc.mode, items: topSel().map(function (id) {
      var o = built.byId[id]; o.updateWorldMatrix(true, false);
      return { id: id, obj: o, w0: o.matrixWorld.clone(), m0: partWorld(id), order: orderOf(id) };
    }) };
  }
  function dragDelta() { pivot.updateMatrixWorld(true); return pivot.matrixWorld.clone().multiply(drag.inv0); }
  function dragMove() {
    if (!drag) return;
    var D = dragDelta();
    drag.items.forEach(function (it) {
      var nw = D.clone().multiply(it.w0);
      it.obj.parent.updateWorldMatrix(true, false);
      nw.premultiply(it.obj.parent.matrixWorld.clone().invert()).decompose(it.obj.position, it.obj.quaternion, it.obj.scale);
    });
    invalidate();
  }
  function dragEnd() {
    if (!drag) return;
    var d = drag, D = dragDelta();
    drag = null;
    var I = new THREE.Matrix4(), same = D.elements.every(function (x, i) { return Math.abs(x - I.elements[i]) < 1e-7; });
    if (same) { attachGizmo(); return; }
    edit(function () {
      d.items.forEach(function (it) {
        var f = find(it.id); if (!f) return;
        var local = parentWorld(it.id).invert().multiply(D.clone().multiply(it.m0));
        var pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        local.decompose(pos, q, s);
        writeAt(f.part, [pos.x, pos.y, pos.z]);
        if (d.mode === "rotate") writeRot(f.part, q, it.order);
        if (d.mode === "scale") writeScale(f.part, [s.x, s.y, s.z]);
      });
    });
  }
  /** A component the drag did not change keeps what it was (an expression stays an expression). */
  function writeAt(p, v) {
    var old = Array.isArray(p.at) ? p.at : [], cur = ev3(old, 0), out = [0, 1, 2].map(function (i) {
      return Math.abs(v[i] - cur[i]) < 1e-3 ? (old[i] !== undefined ? old[i] : 0) : round(v[i], 3);
    });
    if (p.at === undefined && out.every(function (x) { return x === 0; })) return;
    p.at = out;
  }
  function writeRot(p, q, order) {
    var old = Array.isArray(p.rot) ? p.rot : [], cur = ev3(old, 0);
    var q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(cur[0] * DEG, cur[1] * DEG, cur[2] * DEG, order));
    if (q0.angleTo(q) < 1e-6) return;
    var e = new THREE.Euler().setFromQuaternion(q, order), v = [e.x / DEG, e.y / DEG, e.z / DEG];
    var out = [0, 1, 2].map(function (i) { return Math.abs(v[i] - cur[i]) < 1e-3 ? (old[i] !== undefined ? old[i] : 0) : round(v[i], 3); });
    setKey(p, "rot", out.every(function (x) { return x === 0; }) ? undefined : out);
  }
  function writeScale(p, s) {
    var cur = scl3(p.scale);
    if ([0, 1, 2].every(function (i) { return Math.abs(s[i] - cur[i]) < 1e-6; })) return;
    var u = Math.abs(s[0] - s[1]) < 1e-6 && Math.abs(s[1] - s[2]) < 1e-6;
    var v = u ? round(s[0], 5) : s.map(function (x) { return round(x, 5); });
    setKey(p, "scale", v === 1 ? undefined : v);
  }

  // ------------------------------------------------------------------ editing commands
  function niceSize() {
    var m = bbox ? Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z) / 4 : 500;
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(m, 1)))), k = m / p;
    return (k >= 5 ? 5 : k >= 2 ? 2 : 1) * p;
  }
  function addPart(kind) {
    if (!editable()) return;
    var s = niceSize(), g;
    if (kind === "box") g = { size: [s, s, s] };
    else if (kind === "cyl") g = { r: s / 2, h: s };
    else if (kind === "sphere") g = { r: s / 2 };
    else if (kind === "cone") g = { r: s / 2, h: s };
    else if (kind === "prism") g = { n: 6, r: s / 2, h: s };
    else if (kind === "extrude") g = { profile: { rrect: [s, round(s * 0.6), round(s * 0.08)] }, depth: round(s * 0.1) };
    else g = { profile: [[0, 0], [round(s * 0.4), 0], [round(s * 0.25), round(s * 0.5)], [round(s * 0.35), s], [0, s]] };
    var x = bbox ? round(bbox.max.x + s * 0.75, 0) : 0, y = bbox ? round(bbox.min.y, 0) : 0;
    if (kind === "cyl" || kind === "cone" || kind === "prism" || kind === "sphere" || kind === "lathe") { x += s / 2; y += s / 2; }
    var at = [x, y, kind === "sphere" ? s / 2 : 0];
    var id = uid(kind), part = Object.assign({ id: id, name: T.kinds[kind] || kind, kind: kind }, g);
    if (at.some(function (v) { return v !== 0; })) part.at = at;
    edit(function () { if (!Array.isArray(model.parts)) model.parts = []; model.parts.push(part); sel = [id]; });
    pendingFit = true;
  }
  var pendingFit = false;
  function delSel() {
    var ids = topSel();
    if (!ids.length || !editable()) return;
    edit(function () { ids.forEach(function (id) { var f = find(id); if (f) f.list.splice(f.i, 1); }); sel = []; });
  }
  function reId(p) { p.id = uid(p.id); if (p.kind === "group" && Array.isArray(p.parts)) p.parts.forEach(function (c) { if (isObj(c)) reId(c); }); }
  function dupSel() {
    var ids = topSel();
    if (!ids.length || !editable()) return;
    var next = [];
    edit(function () {
      ids.forEach(function (id) {
        var f = find(id); if (!f) return;
        var c = clone(f.part), o = built && built.byId[id], w = 100;
        if (o) { var b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) w = b.max.x - b.min.x; }
        reId(c);
        if (c.name) c.name = String(c.name) + " " + T.copy;
        var at = Array.isArray(c.at) ? c.at.slice() : [0, 0, 0];
        at[0] = round(ev(at[0], 0) + w * 1.2, 1);
        c.at = at;
        f.list.splice(f.i + 1, 0, c);
        next.push(c.id);
      });
      sel = next;
    });
  }
  function toggleHidden(ids) {
    if (!editable()) {
      var allH = ids.every(function (id) { return localHidden[id]; });
      ids.forEach(function (id) { if (allH) delete localHidden[id]; else localHidden[id] = 1; });
      applyVisibility(); renderPanel(); invalidate(); return;
    }
    var all = ids.every(function (id) { var f = find(id); return f && f.part.hidden; });
    edit(function () { ids.forEach(function (id) { var f = find(id); if (f) setKey(f.part, "hidden", all ? undefined : true); }); });
  }
  function hideSel() { if (sel.length) toggleHidden(sel.slice()); }

  // ------------------------------------------------------------------ section: a clipping plane with a cap look
  var clipPlane = null, clipList = null, caps = [], capMats = {};
  function toggleSection() { sec.on = !sec.on; drawSection(); applyClip(); drawChrome(); sendView(); invalidate(); }
  var AX = { x: 0, y: 1, z: 2 };
  function secPos() { if (!bbox) return 0; var i = AX[sec.axis], lo = bbox.min.getComponent(i), hi = bbox.max.getComponent(i); return lo + (hi - lo) * sec.t; }
  function drawSection() {
    if (!THREE) return;
    if (!clipPlane) { clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); clipList = [clipPlane]; }
    secCard.hidden = !sec.on;
    if (!sec.on) { drawSectionOutline(); return; }
    var i = AX[sec.axis], v = secPos(), n = new THREE.Vector3();
    n.setComponent(i, sec.flip ? 1 : -1);
    clipPlane.normal.copy(n); clipPlane.constant = sec.flip ? -v : v;
    var seg = h("span", { "class": "kit-seg", role: "group", "aria-label": T.axis }, ["x", "y", "z"].map(function (a) {
      return h("button", { type: "button", "class": "kit-btn", "aria-pressed": String(sec.axis === a), text: a.toUpperCase(), onclick: function () { sec.axis = a; sec.t = 0.5; drawSection(); applyClip(); sendView(); invalidate(); } });
    }));
    var rng = h("input", { type: "range", min: 0, max: 1, step: 0.001, value: sec.t, "aria-label": T.section });
    var val = h("span", { "class": "md-card-val", text: fmt(v, 0) + " mm" });
    rng.addEventListener("input", function () {
      sec.t = +rng.value; var p = secPos();
      clipPlane.constant = sec.flip ? -p : p; val.textContent = fmt(p, 0) + " mm";
      drawSectionOutline(); addCaps(); invalidate(); sendView();
    });
    var flip = btn(null, T.flip, function () { sec.flip = !sec.flip; drawSection(); applyClip(); invalidate(); }, sec.flip ? "is-on" : "");
    flip.textContent = T.flip;
    secCard.replaceChildren(h("span", { text: T.section.replace(/\s*\(.*\)$/, "") }), seg, rng, val, flip, btn("close", T.close, toggleSection));
    drawSectionOutline();
  }
  function drawSectionOutline() {
    if (!secGrp) return;
    secGrp.children.slice().forEach(function (c) { secGrp.remove(c); c.geometry.dispose(); c.material.dispose(); });
    if (!sec.on || !bbox) return;
    var b = bbox.clone().expandByScalar(Math.max(1, bbox.getSize(new THREE.Vector3()).length() * 0.02)), i = AX[sec.axis], v = secPos(), pts = [];
    var u = (i + 1) % 3, w = (i + 2) % 3, c = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    c.forEach(function (k) {
      var p = new THREE.Vector3(); p.setComponent(i, v);
      p.setComponent(u, k[0] ? b.max.getComponent(u) : b.min.getComponent(u));
      p.setComponent(w, k[1] ? b.max.getComponent(w) : b.min.getComponent(w));
      pts.push(p);
    });
    var l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: TH.accent, transparent: true, opacity: 0.8, toneMapped: false }));
    l.raycast = function () {};
    secGrp.add(l);
  }
  function applyClip() {
    if (!root) return;
    root.traverse(function (o) {
      if (!o.material || o.userData.mdCap) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.clippingPlanes = sec.on ? clipList : null; });
    });
    addCaps();
  }
  function capMat(color) {
    var k = color + (TH.dark ? "d" : "l");
    if (!capMats[k]) {
      var c = new THREE.Color(color).multiplyScalar(0.72);
      capMats[k] = new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide, clippingPlanes: clipList });
    }
    return capMats[k];
  }
  function removeCaps() { caps.forEach(function (c) { if (c.parent) c.parent.remove(c); }); caps = []; }
  /** The cut looks solid: each mesh's back faces, flat and slightly darker, show through the cut. */
  function addCaps() {
    removeCaps();
    if (!sec.on || !root) return;
    var list = [];
    root.traverse(function (o) { if (o.isMesh && !o.userData.mdCap) list.push(o); });
    list.forEach(function (o) {
      var m = o.userData.mdOrig || o.material; m = Array.isArray(m) ? m[0] : m;
      if (m && m.transparent && m.opacity < 0.6) return;
      var cm = capMat(m && m.color ? m.color.getHex() : 0x999999), cap;
      if (o.isInstancedMesh) { cap = new THREE.InstancedMesh(o.geometry, cm, o.count); cap.instanceMatrix = o.instanceMatrix; cap.count = o.count; }
      else cap = new THREE.Mesh(o.geometry, cm);
      cap.userData.mdCap = true; cap.userData.noExport = true; cap.raycast = function () {}; cap.frustumCulled = o.frustumCulled;
      o.add(cap); caps.push(cap);
    });
  }

  // ------------------------------------------------------------------ measure: two clicks, snapping to vertices and edges
  var meas = { pts: [] };
  function setMeasure(on) {
    tool = on ? "measure" : "select";
    if (!on) { meas.pts = []; drawMeasure(); }
    viewEl.classList.toggle("is-measure", on);
    attachGizmo(); drawMeasure(); drawChrome(); invalidate();
  }
  function screenOf(v) { var p = v.clone().project(camera); return { x: (p.x + 1) / 2 * viewW, y: (1 - p.y) / 2 * viewH }; }
  function measureClick(e) {
    var p = pick(e.clientX, e.clientY);
    if (!p) return;
    var r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    var pt = snapPoint(p, sx, sy);
    if (meas.pts.length >= 2) meas.pts = [];
    meas.pts.push(pt);
    drawMeasure(); invalidate();
  }
  function snapPoint(p, sx, sy) {
    var hit = p.hit, o = hit.object, pos = o.geometry && o.geometry.attributes.position, best = null, bd = 12;
    var mw = o.matrixWorld.clone();
    if (o.isInstancedMesh && hit.instanceId != null) { var im = new THREE.Matrix4(); o.getMatrixAt(hit.instanceId, im); mw.multiply(im); }
    var near = function (v, lim) { var s = screenOf(v), d = Math.hypot(s.x - sx, s.y - sy); if (d < lim && d < bd) { bd = d; best = v; } };
    if (pos && hit.face) [hit.face.a, hit.face.b, hit.face.c].forEach(function (i) { near(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw), 12); });
    if (best) return best;
    var part = built.byId[p.id], lines = [];
    if (part) part.traverse(function (x) { if ((x.isLineSegments || x.isLine) && visibleChain(x)) lines.push(x); });
    if (lines.length) {
      // the builder's edge lines don't take part in picking (their raycast is off): test them directly
      var keep = ray.params.Line.threshold, lh = [];
      ray.params.Line.threshold = worldPerPixel(hit.point) * 7;
      lines.forEach(function (l) { THREE.LineSegments.prototype.raycast.call(l, ray, lh); });
      lh.forEach(function (x) { near(x.point.clone(), 8); });
      ray.params.Line.threshold = keep;
    }
    return best || hit.point.clone();
  }
  function worldPerPixel(p) {
    if (camera.isOrthographicCamera) return (ortho.top - ortho.bottom) / ortho.zoom / viewH;
    var d = p.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()));
    return 2 * Math.max(d, 1e-3) * Math.tan(persp.fov * DEG / 2) / viewH;
  }
  function lenText(mm) { var t = fmt(mm, 1) + " mm"; return Math.abs(mm) >= 1000 ? t + " (" + fmt(mm / 1000, 3) + " m)" : t; }
  function fatLine(arr, color, width, onTop) {
    var g = new THREE.LineSegmentsGeometry().setPositions(arr);
    var m = new THREE.LineMaterial({ color: color, linewidth: width, transparent: true, depthTest: !onTop, worldUnits: false, toneMapped: false });
    m.resolution.set(viewW, viewH);
    lineMats.push(m);
    var l = new THREE.LineSegments2(g, m);
    l.raycast = function () {}; l.renderOrder = onTop ? 20 : 5;
    return l;
  }
  function clearGroup(g) {
    g.children.slice().forEach(function (c) {
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) { var i = lineMats.indexOf(c.material); if (i >= 0) lineMats.splice(i, 1); c.material.dispose(); }
    });
  }
  function css2d(cls, html, at) { var d = h("div", { "class": cls, html: html }); var o = new THREE.CSS2DObject(d); o.position.copy(at); return o; }
  function drawMeasure() {
    if (!measGrp) return;
    clearGroup(measGrp);
    measCard.hidden = tool !== "measure";
    if (tool !== "measure") return;
    measCard.replaceChildren(h("span", { text: meas.pts.length === 1 ? T.measureHint2 : T.measureHint }), btn("close", T.close, function () { setMeasure(false); }));
    meas.pts.forEach(function (p) { measGrp.add(css2d("md-mpt", "", p)); });
    if (meas.pts.length < 2) return;
    var a = meas.pts[0], b = meas.pts[1], d = b.clone().sub(a);
    measGrp.add(fatLine([a.x, a.y, a.z, b.x, b.y, b.z], TH.accent, 2.5, true));
    var html = kit.esc(lenText(d.length())) + "<small>dx " + kit.esc(fmt(d.x, 1)) + " \u00b7 dy " + kit.esc(fmt(d.y, 1)) + " \u00b7 dz " + kit.esc(fmt(d.z, 1)) + "</small>";
    measGrp.add(css2d("md-meas", html, a.clone().lerp(b, 0.5)));
    measCard.firstChild.textContent = lenText(d.length());
  }

  // ------------------------------------------------------------------ dimensions from model.dims
  function toggleDims() { showDims = !showDims; drawDims(); drawChrome(); invalidate(); }
  function drawDims() {
    if (!dimsGrp) return;
    clearGroup(dimsGrp);
    if (!showDims || !Array.isArray(model.dims) || !built) return;
    var c = bbox ? bbox.getCenter(new THREE.Vector3()) : new THREE.Vector3(), size = bbox ? bbox.getSize(new THREE.Vector3()).length() : 1000;
    var segs = [];
    model.dims.slice(0, 500).forEach(function (d) {
      if (!isObj(d)) return;
      var a, b;
      if (d.part != null) {
        var o = built.byId[d.part];
        if (!o) return;
        var bb = new THREE.Box3().setFromObject(o);
        if (bb.isEmpty()) return;
        var ax = AX[d.axis] != null ? AX[d.axis] : 0;
        a = bb.min.clone(); b = bb.min.clone(); b.setComponent(ax, bb.max.getComponent(ax));
      } else {
        var f = ev3(d.from, NaN), t = ev3(d.to, NaN);
        if (!f.concat(t).every(isFinite)) return;
        a = new THREE.Vector3(f[0], f[1], f[2]); b = new THREE.Vector3(t[0], t[1], t[2]);
      }
      var len = a.distanceTo(b);
      if (len < 1e-6) return;
      var dir = b.clone().sub(a).normalize(), mid = a.clone().lerp(b, 0.5), n;
      if (Math.abs(dir.z) < 0.9) n = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
      else { n = mid.clone().sub(c); n.z = 0; n.addScaledVector(dir, -n.dot(dir)); if (n.lengthSq() < 1e-9) n.set(-1, 0, 0); n.normalize(); }
      if (n.dot(mid.clone().sub(c)) < 0 && Math.abs(dir.z) < 0.9) n.negate();
      var off = ev(d.offset, size * 0.05);
      if (off < 0) { n.negate(); off = -off; }
      var tick = Math.max(size * 0.008, 1), gap = Math.min(off * 0.15, tick * 2), over = tick * 1.5;
      var p1 = a.clone().addScaledVector(n, off), p2 = b.clone().addScaledVector(n, off), tk = dir.clone().add(n).normalize().multiplyScalar(tick);
      var push = function (u, v) { segs.push(u.x, u.y, u.z, v.x, v.y, v.z); };
      push(p1, p2);
      push(a.clone().addScaledVector(n, gap), a.clone().addScaledVector(n, off + over));
      push(b.clone().addScaledVector(n, gap), b.clone().addScaledVector(n, off + over));
      push(p1.clone().sub(tk), p1.clone().add(tk)); push(p2.clone().sub(tk), p2.clone().add(tk));
      var txt = typeof d.text === "string" && d.text ? d.text : fmt(len, 1);
      dimsGrp.add(css2d("md-dim", kit.esc(txt), p1.clone().lerp(p2, 0.5)));
    });
    if (segs.length) dimsGrp.add(fatLine(segs, TH.fg2, 1.25, false));
  }

  // ------------------------------------------------------------------ bring in a file
  var MESH_EXT = /\.(glb|gltf|stl|obj|ply|3mf)$/i, MAX_MESH = 12 * 1024 * 1024;
  var MIME = { glb: "model/gltf-binary", stl: "model/stl", obj: "model/obj", ply: "application/octet-stream", "3mf": "model/3mf" };
  var fileInput = h("input", { type: "file", accept: ".glb,.gltf,.stl,.obj,.ply,.3mf", hidden: true });
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", function () { var f = fileInput.files && fileInput.files[0]; fileInput.value = ""; if (f) importFile(f); });
  function pickFile() { if (editable()) fileInput.click(); }
  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function importFile(file) {
    if (!editable()) return;
    var m = MESH_EXT.exec(file.name || "");
    if (!m) return kit.toast(T.badExt);
    if (file.size > MAX_MESH) return kit.toast(T.tooBig);
    var ext = m[1].toLowerCase();
    busy(true);
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return Promise.resolve(MK.importMesh(file.name, bytes)).then(function (res) {
        // a single-file glTF is kept as GLB (the server stores glb, stl, obj, ply, 3mf)
        return Promise.resolve(ext === "gltf" ? MK.exportGLB(res.object) : bytes).then(function (out) {
          addFilePart(file.name, ext === "gltf" ? "glb" : ext, out, res);
          if (res.object) res.object.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        });
      });
    }).catch(function (e) { kit.toast(errText(e)); }).then(function () { busy(false); });
  }
  function addFilePart(name, ext, bytes, res) {
    var base = String(name).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "mesh", path, n = 1;
    do { path = "meshes/" + base + (n > 1 ? "-" + n : "") + "." + ext; n++; } while (C.files[path] != null || pendingMeshes[path]);
    var url = "data:" + (MIME[ext] || "application/octet-stream") + ";base64," + b64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    C.files[path] = url; pendingMeshes[path] = url;
    // a mesh read as mm but under 5 mm across was drawn in metres: the builder suggests the unit
    var unitM = res && res.suggestUnit === "m", k = unitM ? 1000 : 1;
    var bb = normBox(res && res.bbox), ext3 = bb ? bb.getSize(new THREE.Vector3()).multiplyScalar(k) : null, s = ext3 ? Math.max(ext3.x, ext3.y, ext3.z) : 0;
    var M = bbox ? Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z) : 0, fit = 0;
    if (s > 0) { if (M > 0) { if (s > M * 5 || s < M / 20) fit = M; } else if (s > 20000 || s < 1) fit = 1000; }
    var part = { id: uid(base), name: String(name).slice(0, 80), kind: "file", src: path };
    if (unitM) part.unit = "m";
    if (fit) { fit = round(fit, 0); part.fit = [fit, fit, fit]; }
    edit(function () { if (!Array.isArray(model.parts)) model.parts = []; model.parts.push(part); sel = [part.id]; });
    pendingPlace = part.id;
    kit.toast(T.imported + ": " + path);
  }
  /** An imported mesh lands on the ground at the origin: once built, its box tells the offset. */
  function placeImported() {
    var id = pendingPlace; pendingPlace = null;
    var o = built.byId[id], f = find(id);
    if (!o || !f) return false;
    var b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty()) return false;
    var c = b.getCenter(new THREE.Vector3()), at = ev3(f.part.at, 0);
    var d = [-c.x, -c.y, -b.min.z];
    if (d.every(function (x) { return Math.abs(x) < 0.5; })) return false;
    f.part.at = [round(at[0] + d[0], 1), round(at[1] + d[1], 1), round(at[2] + d[2], 1)];
    pendingSel = [id]; pendingFit = true;
    dirty = true; status();
    buildAgain = true; // swap runs inside a build: the finishing handler builds again with the new place
    return true;
  }
  viewEl.addEventListener("dragover", function (e) {
    if (!editable() || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
    e.preventDefault(); dropEl.hidden = false;
  });
  viewEl.addEventListener("dragleave", function (e) { if (!viewEl.contains(e.relatedTarget)) dropEl.hidden = true; });
  viewEl.addEventListener("drop", function (e) {
    dropEl.hidden = true;
    if (!editable()) return;
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  // ------------------------------------------------------------------ save and preview
  var saving = false;
  function save() {
    if (!editable() || saving) return;
    var text = modelText(), files = {};
    pendingRefs().forEach(function (p) { files[p] = pendingMeshes[p]; });
    if (text === savedText && !Object.keys(files).length) { dirty = false; status(); return; }
    if (!window.hermes || !window.hermes.save) { kit.toast(T.noSave); return; }
    files["model.json"] = text;
    saving = true; status();
    window.hermes.save(files, C.version).then(function (r) {
      if (r && r.conflict) { stopped = true; kit.toast(T.conflict); attachGizmo(); drawChrome(); if (window.hermes.history) window.hermes.history.show(null); return; }
      if (!r || !r.ok) throw new Error(r && r.error || "save failed");
      C.version = r.version;
      savedText = text; C.files["model.json"] = text;
      Object.keys(files).forEach(function (p) { if (p !== "model.json") delete pendingMeshes[p]; });
      saving = false;
      dirty = modelText() !== savedText || pendingRefs().length > 0;
      status(true);
      sendPreview();
    }).catch(function (e) { kit.toast(T.notSaved + ": " + errText(e)); }).then(function () { saving = false; status(statusEl.textContent === T.saved); sendView(); });
  }
  /** The current view as a PNG without the grid, helpers, gizmo or selection; transparent background. */
  function picture(width) {
    if (!renderer || !root) return null;
    var w = Math.max(16, Math.round(width)), hh = Math.max(16, Math.round(w * viewH / viewW)), pr = renderer.getPixelRatio();
    var keepHover = hover; hover = null;
    restoreAll();
    var vis = [helpers.visible, tcHelper.visible];
    helpers.visible = false; tcHelper.visible = false;
    renderer.setPixelRatio(1); renderer.setSize(w, hh, false); setAspect(w / hh);
    updateClipRange();
    draw(false);
    var url = canvas.toDataURL("image/png");
    helpers.visible = vis[0]; tcHelper.visible = vis[1];
    renderer.setPixelRatio(pr); renderer.setSize(viewW, viewH, false); setAspect(viewW / viewH);
    hover = keepHover; paint(); render();
    return url;
  }
  function sendPreview() {
    if (!window.hermes || typeof window.hermes.preview !== "function" || !root) return;
    var url = null;
    [640, 480, 320].some(function (w) { url = picture(Math.min(w, viewW)); return url && url.length * 0.75 <= 400 * 1024; });
    if (url && url.length * 0.75 <= 400 * 1024) Promise.resolve(window.hermes.preview(url, C.version)).catch(function () {});
  }
  function firstPreview() {
    if (C.preview || !window.hermes || typeof window.hermes.preview !== "function") return;
    setTimeout(function () { if (editable() && latest && !anim) sendPreview(); }, 1500);
  }

  // ------------------------------------------------------------------ export
  function busy(on) {
    var b = document.querySelector(".md-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "md-busy", text: T.building }));
    if (!on && b) b.remove();
  }
  function baseName() { return kit.slug(model.title || C.title || "model"); }
  /** Exports see the model as built: no selection tint, no section caps. */
  function bare(fn) {
    if (!root || !MK) { kit.toast(T.noView); return Promise.resolve(); }
    busy(true); restoreAll(); removeCaps();
    return Promise.resolve().then(fn).catch(function (e) { kit.toast(errText(e)); }).then(function () { busy(false); paint(); addCaps(); invalidate(); });
  }
  function blob(data, type) { return new Blob([data], { type: type }); }
  function dataUrlBlob(url) {
    var bin = atob(url.slice(url.indexOf(",") + 1)), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return blob(b, "image/png");
  }
  var exportList = [
    { id: "glb", label: T.expGlb, run: function () { bare(function () { return Promise.resolve(MK.exportGLB(root)).then(function (b) { kit.download(baseName() + ".glb", blob(b, "model/gltf-binary"), "model/gltf-binary"); }); }); } },
    { id: "stl", label: T.expStl, run: function () { bare(function () { kit.download(baseName() + ".stl", blob(MK.exportSTL(root), "model/stl"), "model/stl"); }); } },
    { id: "obj", label: T.expObj, run: function () { bare(function () { kit.download(baseName() + ".obj", blob(MK.exportOBJ(root), "model/obj"), "model/obj"); }); } },
    { id: "ply", label: T.expPly, run: function () { bare(function () { kit.download(baseName() + ".ply", blob(MK.exportPLY(root), "application/octet-stream"), "application/octet-stream"); }); } },
    { id: "png", label: T.expPng, run: function () { if (!root) return kit.toast(T.noView); var u = picture(Math.min(viewW * 2, 4096)); if (u) kit.download(baseName() + ".png", dataUrlBlob(u), "image/png"); } },
    { id: "csv", label: T.expCsv, run: exportCsv }
  ];
  function exportCsv() {
    if (!built || !MK) return kit.toast(T.noView);
    var rows = MK.takeoff(model, built) || [], hu = L === "hu", sp = hu ? ";" : ",";
    var num = function (v, d) { if (v == null || !isFinite(v)) return ""; var s = String(round(+v, d)); return hu ? s.replace(".", ",") : s; };
    var cell = function (s) { s = String(s == null ? "" : s); return /[";,\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [[T.cId, T.cName, T.cKind, T.cMat, T.cTag, T.cCount, T.cX, T.cY, T.cZ, T.cVol, T.cArea, T.cTVol, T.cTArea].map(cell).join(sp)];
    rows.forEach(function (r) {
      var n = isNum(r.count) ? r.count : 1, sz = Array.isArray(r.size) ? r.size : [];
      var vol = isNum(r.volume) ? r.volume / 1e9 : null, area = isNum(r.area) ? r.area / 1e6 : null;
      lines.push([cell(r.id), cell(r.name), cell(T.kinds[r.kind] || r.kind), cell(r.mat), cell(r.tag), num(n, 0), num(sz[0], 1), num(sz[1], 1), num(sz[2], 1),
        num(vol, 6), num(area, 4), num(vol == null ? null : vol * n, 6), num(area == null ? null : area * n, 4)].join(sp));
    });
    kit.download(baseName() + "-takeoff.csv", blob("\ufeff" + lines.join("\r\n") + "\r\n", "text/csv;charset=utf-8"), "text/csv");
  }
  kit.exports(exportList);

  // ------------------------------------------------------------------ Hermes: comment, ask, view context, versions
  function commentOn() {
    if (!sel.length || !window.hermes || !window.hermes.comment) return;
    var f = find(sel[0]), name = label(f && f.part);
    window.hermes.comment({ selector: "part:" + sel[0], text: name.slice(0, 200), label: name.slice(0, 40) });
  }
  function askAbout() {
    if (!sel.length) return;
    var ids = sel.slice(0, 20);
    var inp = h("input", { "class": "md-askin", placeholder: T.askPh, "aria-label": T.ask });
    drawSelPill(true);
    pillS.replaceChildren(inp, btn("close", T.close, function () { drawSelPill(); }));
    inp.focus();
    inp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { drawSelPill(); return; }
      if (e.key !== "Enter" || !inp.value.trim()) return;
      var list = ids.map(function (id) { var f = find(id), p = f && f.part; return id + (p && p.name ? " \u201c" + String(p.name).slice(0, 60) + "\u201d" : "") + (p ? " " + p.kind : ""); }).join(", ");
      var text = T.about(list) + " " + inp.value.trim();
      if (!window.hermes || !window.hermes.send) { kit.toast(T.noSave); drawSelPill(); return; }
      window.hermes.send(text, { parts: ids, file: "model.json" }, { deliver: "send" })
        .then(function (r) { if (!(r && r.mode === "declined")) kit.toast(T.sent); }, function (err) { kit.toast(errText(err)); });
      drawSelPill();
    });
  }
  if (window.hermes && window.hermes.on) {
    // A comment's anchor clicked in the host: show that part.
    window.hermes.on("flash", function (d) {
      var m = /^part:(.+)$/.exec(String(d && d.selector || ""));
      if (!m || !find(m[1])) return;
      setSel([m[1]]); focusSel();
    });
    // An earlier version is shown: the page only reads.
    window.hermes.on("versions", function (d) {
      if (!d || typeof d.latest !== "number") return;
      var shown = typeof d.shown === "number" ? d.shown : C.version;
      var was = latest;
      latest = shown === d.latest;
      if (was !== latest) { attachGizmo(); status(); drawChrome(); renderPanel(); }
    });
  }
  function sendView() {
    kit.view(function () {
      var ctx = { mode: "model", version: C.version, dirty: dirty, selected: sel.slice(0, 20), selection: sel.slice(0, 5).map(function (id) {
        var f = find(id), p = f ? f.part : {}, it = { id: id, kind: p.kind };
        if (p.name) it.name = String(p.name).slice(0, 60);
        if (p.tag) it.tag = String(p.tag).slice(0, 40);
        if (typeof p.mat === "string") it.mat = p.mat.slice(0, 40);
        return it;
      }) };
      var off = Object.keys(layerOff);
      if (off.length) ctx.hiddenLayers = off.slice(0, 20);
      if (sec.on) ctx.section = { axis: sec.axis, at: round(secPos(), 1), flip: sec.flip };
      if (Object.keys(live).length) ctx.paramPreview = live;
      if (tool === "measure" && meas.pts.length === 2) ctx.measured = round(meas.pts[0].distanceTo(meas.pts[1]), 1);
      if (probs.length) { ctx.problems = probs.length; ctx.firstProblem = (String(probs[0].path || "") + ": " + String(probs[0].msg || "")).slice(0, 120); }
      if (!latest) ctx.readOnly = true;
      return ctx;
    });
  }

  // ------------------------------------------------------------------ keys
  function inField(t) { return t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable); }
  document.addEventListener("keydown", function (e) {
    if (inField(e.target)) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.length === 1 ? k.toLowerCase() : k;
    if (mod && lk === "s") { e.preventDefault(); save(); return; }
    if (mod && lk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && lk === "y") { e.preventDefault(); redo(); return; }
    if (mod && lk === "d") { e.preventDefault(); dupSel(); return; }
    if (mod || e.altKey || !glOK) return;
    if (k === "Escape") {
      if (tool === "measure") { if (meas.pts.length) { meas.pts = []; drawMeasure(); invalidate(); } else setMeasure(false); }
      else if (sel.length) setSel([]);
      return;
    }
    if ((k === "Delete" || k === "Backspace") && sel.length) { e.preventDefault(); delSel(); return; }
    var act = {
      q: function () { setGizmo(null); }, w: function () { setGizmo("translate"); }, e: function () { setGizmo("rotate"); }, r: function () { setGizmo("scale"); },
      f: focusSel, m: function () { setMeasure(tool !== "measure"); }, x: toggleSection, d: toggleDims, h: hideSel,
      p: function () { setOrtho(!camera.isOrthographicCamera); drawChrome(); },
      "1": function () { setView("front"); }, "2": function () { setView("right"); }, "3": function () { setView("top"); }, "0": function () { setView("iso"); }
    }[lk];
    if (act) { e.preventDefault(); act(); }
  });

  // ------------------------------------------------------------------ narrow layout
  var narrowMq = window.matchMedia ? window.matchMedia("(max-width: 700px)") : null;
  function layout() {
    var was = narrow;
    narrow = !!(narrowMq && narrowMq.matches);
    app.classList.toggle("is-narrow", narrow);
    if (narrow && !was) sheetOpen = false;
    renderPanel(); drawChrome();
  }
  if (narrowMq) { if (narrowMq.addEventListener) narrowMq.addEventListener("change", layout); else if (narrowMq.addListener) narrowMq.addListener(layout); }
  window.addEventListener("beforeunload", function () { if (dirty && editable()) save(); });

  // ------------------------------------------------------------------ start
  refreshParams();
  collectProblems();
  layout();
  status();
  function fallback(msg) {
    glOK = false;
    msgEl.hidden = false;
    msgEl.replaceChildren(h("div", {}, [h("b", { text: (isObj(model) && model.title) || C.title || "" }), document.createTextNode(msg)]));
    if (!tab) tab = "outline";
    if (narrow) sheetOpen = true;
    panelHidden = false;
    renderPanel(); drawChrome(); firstShown();
  }
  if (!MK) { fallback(T.noKit); return; }
  loadThree().then(function () {
    if (!initGL()) return fallback(T.noGL);
    glOK = true;
    refreshParams();
    drawChrome(); renderPanel();
    rebuild();
  }, function (e) { console.warn(e); fallback(T.noLib); });

  window.__model = {
    model: function () { return model; }, built: function () { return built; }, sel: function () { return sel.slice(); }, setSel: setSel,
    text: modelText, save: save, undo: undo, redo: redo, addPart: addPart, delSel: delSel, dupSel: dupSel, setGizmo: setGizmo,
    exports: exportList, picture: picture, importFile: importFile, setView: setView, setOrtho: setOrtho, fitAll: fitAll,
    section: function (on, axis, t) { sec.on = on; if (axis) sec.axis = axis; if (t != null) sec.t = t; drawSection(); applyClip(); drawChrome(); invalidate(); },
    measure: setMeasure, measurePts: function (a, b) { meas.pts = [new THREE.Vector3().fromArray(a), new THREE.Vector3().fromArray(b)]; drawMeasure(); invalidate(); },
    state: function () { return { dirty: dirty, tool: tool, gizmo: gizmoMode, sec: sec, dims: showDims, latest: latest, glOK: glOK, probs: probs, live: live, tab: tab, narrow: narrow, camera: camera && camera.type }; },
    three: function () { return { renderer: renderer, scene: scene, camera: camera, controls: controls, tc: tc, pivot: pivot }; },
    drag: function (fn) { dragStart(); fn(pivot); dragMove(); dragEnd(); }, pick: pick, commitParam: commitParam, render: render
  };
})();
