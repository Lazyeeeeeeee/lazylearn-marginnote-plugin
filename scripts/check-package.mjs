// 包装完整性 + 桥契约检查：node scripts/check-package.mjs
//
// 这三样东西错了，装到 MarginNote 上才会炸，而且报错很难读：
//   1. main.js 里 JSB.require 了一个包里没有的文件（插件整个加载失败）；
//   2. 网页面板 call 了一个插件命令表里不存在的命令（点下去才报 Unknown bridge command）；
//   3. mnaddon.json / package.json / web-dist 对不上（版本盖章漏了、前端没打）。
// 所以放在打包链路里当闸门：不需要真机、不需要 zip，几百毫秒跑完。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const matches = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1]);

// 1) main.js 只该有 JSB.require，且每个都指向包里的文件
const mainSource = read("src/main.js");
assert.ok(
  !/\brequire\s*\(/.test(mainSource.replace(/JSB\.require\s*\(/g, "")),
  "main.js 里出现了非 JSB.require 的 require（JSCore 没有模块系统）",
);
const required = matches(mainSource, /JSB\.require\(\s*["']([^"']+)["']\s*\)/g);
assert.ok(required.length >= 5, `main.js 里只找到 ${required.length} 处 JSB.require，像是漏了`);
required.forEach((name) => {
  assert.ok(exists(`src/${name}.js`), `main.js require 了「${name}」，但 src/${name}.js 不在包里`);
});

// 2) 网页调的桥命令，插件命令表里必须有
const called = matches(read("web/src/lib/pluginApi.js"), /call\(\s*["']([^"']+)["']/g);
assert.ok(called.length >= 8, `网页只调了 ${called.length} 个桥命令，像是没解析出来`);
const bridgeSource = read("src/WebBridgeCommands.js");
called.forEach((name) => {
  assert.ok(
    new RegExp(`\\b${name}\\s*:`).test(bridgeSource),
    `网页调用了「${name}」，但 src/WebBridgeCommands.js 的命令表里没有`,
  );
});

// 3) 模板占位符必须都被替换（真机上它们会原样显示给用户）
// MN Rails 的 web 模板会留 __MN_WEB_PANEL_TITLE__ / __MN_WEB_STATE_KEY_PREFIX__ 这类占位符，
// 不替换的话：面板标题就叫「__MN_WEB_PANEL_TITLE__」，偏好键里也真带着那串下划线（同模板的
// 插件互相抢同一组键）。这里只允许框架自己的几个标识符，其余一律报错。
const FRAMEWORK_TOKENS = new Set([
  "__MN_WEB_API_GLOBAL__",
  "__MN_WEB_BRIDGE_COMMANDS_GLOBAL__",
  "__MN_WEB_BRIDGE_RECEIVE_FN__",
  "__MN_WEB_GET_DEV_SERVER_URL_FN__",
]);
const shippedNativeFiles = fs
  .readdirSync(path.join(root, "src"))
  .filter((name) => name.endsWith(".js"));
shippedNativeFiles.forEach((name) => {
  const text = read(`src/${name}`);
  matches(text, /(__MN_WEB_[A-Z_]+__)/g).forEach((token) => {
    assert.ok(FRAMEWORK_TOKENS.has(token), `src/${name} 里还留着模板占位符 ${token}，真机上会原样显示`);
  });
});
const panelController = read("src/WebPanelController.js");
assert.ok(
  !/__MN_WEB_STATE_KEY_PREFIX__|__MN_WEB_PANEL_TITLE__/.test(panelController),
  "WebPanelController.js 里的模板占位符没替换（面板标题 / 偏好键前缀）",
);

// 4) 元数据与前端产物
const addon = JSON.parse(read("src/mnaddon.json"));
const pkg = JSON.parse(read("package.json"));
["addonid", "author", "title", "version", "marginnote_version_min"].forEach((key) => {
  assert.ok(addon[key], `src/mnaddon.json 缺 ${key}`);
});
assert.equal(
  addon.version,
  pkg.version,
  "src/mnaddon.json 与 package.json 版本不一致（使用本仓库 scripts/bump-version.js 同步版本）",
);

assert.ok(
  exists("src/web-dist/index.html"),
  "src/web-dist/index.html 不在包里：先跑 npm run build:web 或 npm run build",
);
const html = read("src/web-dist/index.html");
const assets = matches(html, /(?:src|href)="\.\/assets\/([^"]+)"/g);
assert.ok(assets.length >= 2, "web-dist/index.html 里没找到 assets 引用（JS 与 CSS 各一个）");
assets.forEach((asset) => {
  assert.ok(exists(`src/web-dist/assets/${asset}`), `web-dist 少了 assets/${asset}`);
});

console.log(
  `✓ package ok（require ${required.length} 个、桥命令 ${called.length} 个、原生文件 ${shippedNativeFiles.length} 个、版本 ${pkg.version}）`,
);
