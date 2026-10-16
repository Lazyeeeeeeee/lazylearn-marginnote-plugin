JSB.require("base64");
JSB.require("network");
JSB.require("lazylearn");
JSB.require("tutor");
JSB.require("notebook");
JSB.require("pullcards");
JSB.require("selection");
JSB.require("WebDevServerConfig");
JSB.require("WebBridgeCommands");
JSB.require("WebPanelController");
JSB.require("WebAddon");

JSB.newAddon = function (mainPath) {
  return createLazyLearnAddon(mainPath);
};
