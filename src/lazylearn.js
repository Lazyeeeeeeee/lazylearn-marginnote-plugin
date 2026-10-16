// lazylearn.js —— 懒学 API 客户端。跑在插件的 JavaScriptCore 里（没有 fetch），
// 一律经 LazyLearnNetwork 发请求；会话 token 存在 NSUserDefaults，不进网页存储。
var LazyLearnApi = (function () {
  var DEFAULT_BASE_URL = "https://lazylearn.cn";
  var KEY_BASE_URL = "lazylearn_base_url";
  var KEY_TOKEN = "lazylearn_token";
  var KEY_USERNAME = "lazylearn_username";
  var TIMEOUT_SECONDS = 15;
  // 对话是「完整生成后一次性返回」，慢的时候要几十秒——别让 15 秒的超时把回答掐掉。
  var STREAM_TIMEOUT_SECONDS = 120;

  function isNil(value) {
    return (
      value === null ||
      value === undefined ||
      (typeof NSNull !== "undefined" && value instanceof NSNull)
    );
  }

  function defaults() {
    return NSUserDefaults.standardUserDefaults();
  }

  function readString(key) {
    var value = defaults().objectForKey(key);
    return isNil(value) ? "" : String(value);
  }

  function writeString(key, value) {
    defaults().setObjectForKey(String(value), key);
  }

  function clearKey(key) {
    defaults().removeObjectForKey(key);
  }

  function baseUrl() {
    var configured = readString(KEY_BASE_URL).trim();
    return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  function setBaseUrl(url) {
    var next = String(url || "").trim().replace(/\/+$/, "");
    if (!next) {
      clearKey(KEY_BASE_URL);
      return baseUrl();
    }
    if (next.indexOf("://") === -1) next = "https://" + next;
    writeString(KEY_BASE_URL, next);
    return next;
  }

  function token() {
    return readString(KEY_TOKEN);
  }

  function session() {
    return {
      baseUrl: baseUrl(),
      username: readString(KEY_USERNAME),
      loggedIn: token().length > 0,
    };
  }

  function clearSession() {
    clearKey(KEY_TOKEN);
    clearKey(KEY_USERNAME);
  }

  function describeFailure(response, payload) {
    var detail =
      payload && typeof payload === "object" && payload.detail
        ? String(payload.detail)
        : "请求失败（HTTP " + response.status + "）";
    var failure = new Error(detail);
    failure.status = response.status;
    return failure;
  }

  async function fetchResponse(path, options) {
    var opts = options || {};
    var headers = {};
    if (opts.auth !== false && token()) {
      headers.Authorization = "Bearer " + token();
    }
    if (opts.headers) {
      for (var key in opts.headers) headers[key] = opts.headers[key];
    }

    try {
      return await LazyLearnNetwork.fetch(baseUrl() + path, {
        method: opts.method || "GET",
        headers: headers,
        json: opts.json,
        search: opts.search,
        timeout: opts.timeout || TIMEOUT_SECONDS,
      });
    } catch (error) {
      throw new Error("网络异常：" + String(error));
    }
  }

  async function request(path, options) {
    var response = await fetchResponse(path, options);
    var payload = response.json();
    if (payload === null) payload = response.text();

    if (response.status >= 200 && response.status < 300) {
      return payload;
    }
    if (response.status === 401) {
      clearSession();
    }
    throw describeFailure(response, payload);
  }

  // 对话接口回的是 text/event-stream：拿原文自己按帧解析（见 tutor.js）。
  async function requestText(path, options) {
    var response = await fetchResponse(path, options);
    if (response.status >= 200 && response.status < 300) {
      return response.text();
    }
    var payload = response.json();
    if (response.status === 401) {
      clearSession();
    }
    throw describeFailure(response, payload && typeof payload === "object" ? payload : null);
  }

  async function login(username, password) {
    var account = String(username || "").trim();
    if (!account || !password) {
      throw new Error("账号和密码都要填");
    }

    var result = await request("/api/auth/login", {
      method: "POST",
      auth: false,
      json: { username: account, password: String(password) },
    });
    var issued = result && result.token ? String(result.token) : "";
    if (!issued) {
      throw new Error("登录成功但没拿到会话，请重试");
    }

    writeString(KEY_TOKEN, issued);
    writeString(KEY_USERNAME, account);

    var profile = await me();
    var current = session();
    return {
      baseUrl: current.baseUrl,
      username: current.username,
      loggedIn: current.loggedIn,
      profile: profile,
    };
  }

  async function me() {
    return await request("/api/auth/me");
  }

  async function logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // 服务端会话清不掉也要让本地退出：留着 token 只会让人以为还登着。
    }
    clearSession();
    return session();
  }

  async function createCard(card) {
    if (!token()) {
      throw new Error("先登录懒学账号");
    }
    var body = {
      front: String(card.front || "").trim(),
      back: String(card.back || "").trim(),
    };
    if (card.subject) body.subject = String(card.subject);
    if (card.taxonomyId) body.taxonomyId = String(card.taxonomyId);
    if (card.externalId) body.externalId = String(card.externalId);
    return await request("/api/recite/cards", { method: "POST", json: body });
  }

  // 闪卡清单：scope = deck（队列里）/ mine（我建的）/ all。
  async function listCards(options) {
    var opts = options || {};
    var scope = opts.scope === "mine" || opts.scope === "all" ? opts.scope : "deck";
    var limit = Number(opts.limit) > 0 ? Math.min(Math.floor(Number(opts.limit)), 50) : 20;
    return await request("/api/recite/cards", {
      search: { scope: scope, limit: String(limit) },
    });
  }

  async function searchQuestions(query, limit) {
    var q = String(query || "").trim();
    if (!q) return { items: [], source: "text" };
    return await request("/api/search/questions", {
      search: { q: q, limit: String(limit || 10) },
    });
  }

  async function createConversation(title) {
    var body = { title: String(title || "MarginNote 随手问").slice(0, 60) };
    var conversation = await request("/api/conversations", { method: "POST", json: body });
    return conversation && conversation.id ? String(conversation.id) : "";
  }

  // 会把整段 SSE 读回来再解析，所以超时按生成时间给足。
  // options.cardsRequest 交给服务端进「制卡」模式（那次回答里会直接把卡写进队列）；
  // options.media 是 /api/media 上传回来的那几条附件。
  async function askTutor(conversationId, content, options) {
    var opts = options || {};
    var body = { content: String(content || "") };
    if (opts.cardsRequest) body.cardsRequest = true;
    if (opts.subject) body.subject = String(opts.subject);
    if (opts.media && opts.media.length) body.media = opts.media;

    return await requestText("/api/conversations/" + encodeURIComponent(conversationId) + "/messages", {
      method: "POST",
      timeout: STREAM_TIMEOUT_SECONDS,
      json: body,
    });
  }

  async function saveNote(note) {
    if (!token()) {
      throw new Error("先登录懒学账号");
    }
    return await request("/api/notes", {
      method: "POST",
      json: {
        title: String(note.title || "MarginNote 笔记").slice(0, 200),
        body: String(note.body || ""),
      },
    });
  }

  // 手写/图片评论（PaintNote）问懒懒：哈希 → NSData → multipart 传到 /api/media?scope=chat。
  // 字段名与响应形状照抄小程序那条路（`name: 'file'` → {objectKey,url,contentType,filename}）；
  // 图片格式由服务端嗅探（HEIC 也会被它转成 JPEG），所以这里给的 contentType 只是个提示。
  var UPLOAD_TIMEOUT_SECONDS = 60;

  function randomBoundary() {
    return "----LazyLearnBoundary" + String(new Date().getTime()) + String(Math.floor(Math.random() * 1e9));
  }

  function utf8(text) {
    return NSData.dataWithStringEncoding(String(text), 4);
  }

  function encodeFileName(name) {
    return String(name || "note.png").replace(/[\r\n"]/g, "");
  }

  function mediaFromHash(hash) {
    var data = safeMedia(hash);
    if (!data || data.length() === 0) {
      throw new Error("读不到这张图，可能还没同步到本机");
    }

    var boundary = randomBoundary();
    var head =
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="file"; filename="' + encodeFileName("marginnote.png") + '"\r\n' +
      "Content-Type: image/png\r\n\r\n";
    var tail = "\r\n--" + boundary + "--\r\n";

    var body = NSMutableData.dataWithCapacity(data.length() + 512);
    body.appendData(utf8(head));
    body.appendData(data);
    body.appendData(utf8(tail));

    var request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(baseUrl() + "/api/media?scope=chat"));
    request.setHTTPMethod("POST");
    request.setTimeoutInterval(UPLOAD_TIMEOUT_SECONDS);
    var headers = {
      "Accept": "application/json",
      "Content-Type": "multipart/form-data; boundary=" + boundary,
    };
    if (token()) headers.Authorization = "Bearer " + token();
    request.setAllHTTPHeaderFields(headers);
    request.setHTTPBody(body);

    return new Promise(function (resolve, reject) {
      NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(
        request,
        NSOperationQueue.mainQueue(),
        function (response, data, error) {
          if (!isNil(error)) {
            reject(new Error("图片上传失败：" + String(error.localizedDescription || error)));
            return;
          }
          var status = response ? response.statusCode() : 0;
          var parsed = data && data.length() ? NSJSONSerialization.JSONObjectWithDataOptions(data, 1) : null;
          if (status < 200 || status >= 300) {
            if (status === 401) clearSession();
            var detail = parsed && parsed.detail ? String(parsed.detail) : "图片上传失败（HTTP " + status + "）";
            reject(new Error(detail));
            return;
          }
          resolve(parsed || {});
        }
      );
    });
  }

  function safeMedia(hash) {
    var wanted = String(hash || "").trim();
    if (!wanted) return null;
    try {
      return Database.sharedInstance().getMediaByHash(wanted) || null;
    } catch (error) {
      return null;
    }
  }

  async function uploadNoteImage(hash) {
    if (!token()) {
      throw new Error("先登录懒学账号");
    }
    var uploaded = await mediaFromHash(hash);
    var objectKey = uploaded && uploaded.objectKey ? String(uploaded.objectKey) : "";
    if (!objectKey) {
      throw new Error("图片上传失败，请重试");
    }
    return {
      objectKey: objectKey,
      url: uploaded.url ? String(uploaded.url) : "",
      contentType: uploaded.contentType ? String(uploaded.contentType) : "image/png",
      filename: uploaded.filename ? String(uploaded.filename) : "marginnote.png",
    };
  }

  // 只给「能贴得住」的固定路径：闪卡在「学习 → 背卡」（/study/recite），
  // 题库在「学习 → 练」（/study/practice）。题目详情没有按 id 的深链，
  // 所以带上题干让用户到练题页接着搜，不编一个查不到的 query。
  function cardUrl() {
    return baseUrl() + "/study/recite";
  }

  function practiceUrl() {
    return baseUrl() + "/study/practice";
  }

  return {
    baseUrl: baseUrl,
    setBaseUrl: setBaseUrl,
    session: session,
    clearSession: clearSession,
    login: login,
    me: me,
    logout: logout,
    createCard: createCard,
    listCards: listCards,
    searchQuestions: searchQuestions,
    createConversation: createConversation,
    askTutor: askTutor,
    uploadNoteImage: uploadNoteImage,
    saveNote: saveNote,
    read: readString,
    write: writeString,
    clear: clearKey,
    cardUrl: cardUrl,
    practiceUrl: practiceUrl,
  };
})();
