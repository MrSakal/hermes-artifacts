// hermes-artifacts in the web dashboard (hermes dashboard): the plugin's backend is mounted from
// plugin_api.py; its pages live in Hermes Desktop. The manifest's tab is hidden, so this registers an empty
// component for it (a direct visit to /hermes-artifacts says where the artifacts are).
(function () {
  "use strict";
  var SDK = window.__HERMES_PLUGIN_SDK__;
  var plugins = window.__HERMES_PLUGINS__;
  if (!SDK || !SDK.React || !plugins || typeof plugins.register !== "function") return;
  var h = SDK.React.createElement;
  function ArtifactsHere() {
    return h("p", { className: "p-6 text-sm text-muted-foreground" },
      "Artifacts open in Hermes Desktop: its Artifacts page in the sidebar.");
  }
  plugins.register("hermes-artifacts", ArtifactsHere);
})();
