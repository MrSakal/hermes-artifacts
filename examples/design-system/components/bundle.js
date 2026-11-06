/* @ds-bundle: {"format":4,"namespace":"Kiln","components":[{"name":"Button"},{"name":"Tag"},{"name":"Notice"}]} */
(function () {
  "use strict";
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  /** Button({label, variant: "primary" | "quiet", disabled, onClick}) -> <button> */
  function Button(p) {
    p = p || {};
    var b = el("button", "kl-btn kl-btn-" + (p.variant === "primary" ? "primary" : "quiet"), p.label || "");
    b.type = "button";
    if (p.disabled) b.disabled = true;
    if (typeof p.onClick === "function") b.addEventListener("click", p.onClick);
    return b;
  }
  /** Tag({label, tone: "neutral" | "clay" | "glaze"}) -> <span> */
  function Tag(p) {
    p = p || {};
    var tone = p.tone === "clay" || p.tone === "glaze" ? p.tone : "neutral";
    return el("span", "kl-tag kl-tag-" + tone, p.label || "");
  }
  /** Notice({title, body, tone: "glaze" | "clay"}) -> <div role="status"> */
  function Notice(p) {
    p = p || {};
    var n = el("div", "kl-notice kl-notice-" + (p.tone === "clay" ? "clay" : "glaze"));
    n.setAttribute("role", "status");
    n.appendChild(el("span", "kl-notice-dot"));
    var t = el("div", "kl-notice-text");
    if (p.title) t.appendChild(el("strong", "kl-notice-title", p.title));
    if (p.body) t.appendChild(el("span", "kl-notice-body", p.body));
    n.appendChild(t);
    return n;
  }
  window.Kiln = Object.assign(window.Kiln || {}, { Button: Button, Tag: Tag, Notice: Notice });
})();
