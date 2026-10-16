// WebBridgeCommands.js —— 网页面板 (web-dist) 与插件原生侧的桥。
// 网页发出一段 mnaddon://bridge 导航，WebPanelController 在这里查表执行。
// 命令实现只依赖：LazyLearnApi（API 客户端）、LazyLearnSelection（当前选区）、context.controller（面板）。
var __MN_WEB_BRIDGE_COMMANDS_GLOBAL__ = (function () {
  function toBridgePayload(value) {
    return value === undefined ? null : value;
  }

  function ping(context, payload) {
    return {
      now: new Date().toISOString(),
      source: "lazylearn-addon",
      payload: toBridgePayload(payload),
      addon: context.addon && context.addon.window ? "available" : "unavailable",
    };
  }

  function echo(context, payload) {
    return {
      echoed: toBridgePayload(payload),
    };
  }

  function closePanel(context, payload) {
    context.closePanel(context.controller);
    return {
      closed: true,
      payload: toBridgePayload(payload),
    };
  }

  function getSelection(context) {
    return LazyLearnSelection.read(context.addon);
  }

  function getSession() {
    return LazyLearnApi.session();
  }

  function saveBaseUrl(context, payload) {
    var baseUrl = LazyLearnApi.setBaseUrl(payload && payload.baseUrl);
    var current = LazyLearnApi.session();
    return { baseUrl: baseUrl, username: current.username, loggedIn: current.loggedIn };
  }

  function login(context, payload) {
    var body = payload || {};
    return LazyLearnApi.login(body.username, body.password).then(function (result) {
      return result;
    });
  }

  function logout() {
    // 会话换了人，上次那条助教会话就不该再接着问（别人的 convId 会 404）：
    // 退出登录顺手把本地记的那条也清掉。
    LazyLearnTutor.reset();
    return LazyLearnApi.logout();
  }

  function me() {
    return LazyLearnApi.me();
  }

  function createCard(context, payload) {
    return LazyLearnApi.createCard(payload || {}).then(function (card) {
      return {
        card: card,
        cardUrl: LazyLearnApi.cardUrl(),
      };
    });
  }

  function searchQuestions(context, payload) {
    var body = payload || {};
    return LazyLearnApi.searchQuestions(body.q, body.limit).then(function (result) {
      var items = (result && result.items) || [];
      return {
        source: (result && result.source) || "text",
        items: items.map(function (item) {
          return {
            id: item.id,
            stem: item.stem,
            kind: item.kind,
            seq: item.seq,
            // 题目详情没有按 id 的稳定深链，给练题页，用户在那边搜同一个考点。
            url: LazyLearnApi.practiceUrl(),
          };
        }),
      };
    });
  }

  // 服务端的「制卡」模式（cardsRequest）会把做好的卡直接写进闪卡队列，插件这边不用解析卡面，
  // 只把回答原文摆给用户看。一次材料一趟会话：制卡会把会话切到那个模式，别污染助教的追问流。
  async function makeCards(context, payload) {
    var body = payload || {};
    var material = String(body.excerpt || "").trim();
    if (!material) throw new Error("先在 PDF 里选中一段材料");
    if (!LazyLearnApi.session().loggedIn) throw new Error("先登录懒学账号");

    var limit = Number(body.limit) > 0 ? Math.min(Number(body.limit), 20) : 8;
    var title = body.noteTitle ? "MarginNote 制卡 · " + String(body.noteTitle) : "MarginNote 制卡";
    var conversationId = await LazyLearnApi.createConversation(title);
    var prompt =
      "把下面这段材料直接做成记忆卡并存库，最多 " + limit + " 张，一张卡只装一个考点；" +
      "不用再问我确不确认，材料就是这一段：\n\n" +
      material;

    var raw = await LazyLearnApi.askTutor(conversationId, prompt, {
      cardsRequest: true,
      subject: body.subject,
    });
    var answer = LazyLearnTutor.parseAnswer(raw);
    if (answer.failed) throw new Error(answer.detail);
    if (!answer.content) throw new Error("制卡没有返回内容，请重试");

    return {
      conversationId: conversationId,
      answer: answer.content,
      url: LazyLearnApi.cardUrl(),
    };
  }

  function askTutor(context, payload) {
    var body = payload || {};
    return LazyLearnTutor.ask(body.prompt, {
      title: body.title,
      newConversation: Boolean(body.newConversation),
      imageHash: body.imageHash,
    });
  }

  function resetTutor() {
    return LazyLearnTutor.reset();
  }

  function getTutorSession() {
    var conversationId = LazyLearnTutor.conversationId();
    return { conversationId: conversationId, hasConversation: conversationId.length > 0 };
  }

  function saveNote(context, payload) {
    var body = payload || {};
    return LazyLearnApi.saveNote({ title: body.title, body: body.body }).then(function (note) {
      return {
        id: note && note.id ? String(note.id) : "",
        title: note && note.title ? String(note.title) : String(body.title || ""),
        url: LazyLearnApi.baseUrl() + "/study/wiki",
      };
    });
  }

  function previewNotebook(context, payload) {
    return LazyLearnNotebook.preview(context.addon, payload && payload.mode);
  }

  // 正文可能有上百 K，所以按模式在原生侧重新收一次再逐篇写，不来回穿桥。
  async function importNotebook(context, payload) {
    var body = payload || {};
    var collected = LazyLearnNotebook.documents(context.addon, body.mode);
    if (!collected.available) {
      throw new Error(collected.reason || "读不到这个笔记本");
    }

    var saved = [];
    for (var index = 0; index < collected.documents.length; index += 1) {
      var doc = collected.documents[index];
      var title = index === 0 && body.title ? String(body.title) : doc.title;
      var note = await LazyLearnApi.saveNote({ title: title, body: doc.markdown });
      saved.push({ id: note && note.id ? String(note.id) : "", title: title });
    }

    return {
      count: saved.length,
      titles: saved.map(function (row) {
        return row.title;
      }),
      noteCount: collected.noteCount,
      truncated: collected.truncated,
      url: LazyLearnApi.baseUrl() + "/study/wiki",
    };
  }

  function previewPullCards(context, payload) {
    return LazyLearnPull.preview(context.addon, payload || {});
  }

  function pullCards(context, payload) {
    return LazyLearnPull.pull(context.addon, payload || {});
  }

  const commands = {
    ping: ping,
    echo: echo,
    closePanel: closePanel,
    getSelection: getSelection,
    getSession: getSession,
    saveBaseUrl: saveBaseUrl,
    login: login,
    logout: logout,
    me: me,
    createCard: createCard,
    searchQuestions: searchQuestions,
    makeCards: makeCards,
    askTutor: askTutor,
    resetTutor: resetTutor,
    getTutorSession: getTutorSession,
    saveNote: saveNote,
    previewNotebook: previewNotebook,
    previewPullCards: previewPullCards,
    pullCards: pullCards,
    importNotebook: importNotebook,
  };

  return {
    commands: commands,
  };
})();
