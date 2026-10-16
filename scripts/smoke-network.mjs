// 10 秒冒烟：真实网络封装 + 独立脚本加载 + 发布压缩，不访问真实账号。
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { minify } from "terser";

const read = (name) => fs.readFileSync(new URL(`../src/${name}.js`, import.meta.url), "utf8");

for (const compressed of [false, true]) {
  const requests = [];
  const preferences = new Map();
  let failure = null;
  const existingNetwork = {};
  const existingResponse = {};
  const context = vm.createContext({
    MNNetwork: existingNetwork,
    Response: existingResponse,
    NSNull: class NSNull {},
    NSUserDefaults: { standardUserDefaults: () => ({
      objectForKey: (key) => preferences.get(key),
      setObjectForKey: (value, key) => preferences.set(key, value),
      removeObjectForKey: (key) => preferences.delete(key),
    }) },
    NSURL: { URLWithString: (url) => url },
    NSMutableURLRequest: { requestWithURL: (url) => {
      const request = { url };
      for (const [method, key] of Object.entries({
        setHTTPMethod: "method", setTimeoutInterval: "timeout",
        setAllHTTPHeaderFields: "headers", setHTTPBody: "body",
      })) request[method] = (value) => { request[key] = value; };
      return request;
    } },
    NSJSONSerialization: {
      dataWithJSONObjectOptions: (value) => JSON.stringify(value),
      JSONObjectWithDataOptions: (data) => JSON.parse(data.raw),
    },
    NSOperationQueue: { mainQueue: () => ({}) },
    NSURLConnection: { sendAsynchronousRequestQueueCompletionHandler: (request, queue, callback) => {
      requests.push(request);
      const raw = request.url.endsWith("/login")
        ? '{"token":"smoke-token"}' : '{"username":"smoke-user"}';
      callback({ statusCode: () => 200 }, { raw, length: () => raw.length }, failure);
    } },
  });
  for (const name of ["network", "lazylearn"]) {
    const source = read(name);
    const code = compressed ? (await minify(source, { compress: true, mangle: true })).code : source;
    vm.runInContext(code, context, { filename: `${name}.js` });
  }
  assert.equal(typeof context.LazyLearnNetwork.fetch, "function", "网络接口必须显式导出为全局属性");
  const session = await context.LazyLearnApi.login("smoke-user", "smoke-password");
  assert.equal(session.loggedIn, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://lazylearn.cn/api/auth/login");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].timeout, 15);
  assert.equal(JSON.parse(requests[0].body).username, "smoke-user");
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests[1].headers.Authorization, "Bearer smoke-token");
  assert.equal(context.MNNetwork, existingNetwork, "不能覆盖其他插件的网络对象");
  assert.equal(context.Response, existingResponse, "响应类不能泄漏到共享全局");
  failure = { localizedDescription: "offline" };
  await assert.rejects(() => context.LazyLearnApi.me(), /网络异常：offline/);
}

console.log("✓ network smoke ok（源码与压缩代码：全局导出、原生登录、鉴权、网络错误）");
