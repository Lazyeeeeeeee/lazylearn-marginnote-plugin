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

  // 个性化题组：同一次 requestId 在服务端只记一次，条件不变就重放同一组。
  // 选题和取题面是两步，任一步失败都保留 id，重试时不会多算一组。
  var practiceRequest = null;

  function stringList(value) {
    if (Object.prototype.toString.call(value) !== "[object Array]") return [];
    var items = [];
    value.forEach(function (item) {
      var text = String(item === null || item === undefined ? "" : item).trim();
      if (text) items.push(text);
    });
    return items;
  }

  function normalizeTopicName(name) {
    return String(name || "").trim().replace(/\s+/g, "");
  }

  function shallowest(nodes) {
    var copy = nodes.slice();
    copy.sort(function (left, right) {
      return Number(left.level || 0) - Number(right.level || 0);
    });
    return copy[0] || null;
  }

  // 与懒学网页端的匹配规则一致：先精确、再去空白，命中多个时取层级最浅的那个。
  function matchTaxonomy(name, nodes) {
    var trimmed = String(name || "").trim();
    if (!trimmed) return null;
    var exact = nodes.filter(function (node) {
      return String((node && node.name) || "").trim() === trimmed;
    });
    if (exact.length) return shallowest(exact);
    var normalized = normalizeTopicName(trimmed);
    var fuzzy = nodes.filter(function (node) {
      return normalizeTopicName(node && node.name) === normalized;
    });
    return fuzzy.length ? shallowest(fuzzy) : null;
  }

  // 新账号按学科取；老账号只有平铺列表时回退到旧列表（与网页端 weakTopicsFor 一致）。
  function weakTopicNames(prefs, subject) {
    var bySubject = prefs && prefs.weakTopicsBySubject;
    if (bySubject && Object.prototype.hasOwnProperty.call(bySubject, subject)) {
      return stringList(bySubject[subject]);
    }
    return stringList(prefs && prefs.weakTopics);
  }

  function examScopeFor(prefs, subject) {
    if (subject === "math") return prefs && prefs.mathCategory ? String(prefs.mathCategory) : "";
    if (subject === "english") return prefs && prefs.englishTrack ? String(prefs.englishTrack) : "";
    return "";
  }

  function practiceRequestId() {
    return "mn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function groupConditions(subject, examScope, chapterIds, limit) {
    return {
      subject: subject,
      examScope: examScope || null,
      chapterIds: chapterIds,
      limit: limit,
    };
  }

  async function requestPracticeGroup(conditions) {
    var key = JSON.stringify(conditions);
    if (!practiceRequest || practiceRequest.key !== key) {
      practiceRequest = { key: key, requestId: practiceRequestId() };
    }
    return await LazyLearnApi.createPracticeGroup({
      requestId: practiceRequest.requestId,
      subject: conditions.subject,
      examScope: conditions.examScope,
      chapterIds: conditions.chapterIds,
      limit: conditions.limit,
    });
  }

  function getPreferences() {
    return LazyLearnApi.preferences().then(function (prefs) {
      return {
        enabledSubjects: stringList(prefs && prefs.enabledSubjects),
        weakTopics: stringList(prefs && prefs.weakTopics),
        weakTopicsBySubject: (prefs && prefs.weakTopicsBySubject) || {},
        mathCategory: prefs && prefs.mathCategory ? String(prefs.mathCategory) : "",
        englishTrack: prefs && prefs.englishTrack ? String(prefs.englishTrack) : "",
      };
    });
  }

  async function practiceGroup(context, payload) {
    var body = payload || {};
    var subject = String(body.subject || "").trim();
    if (["math", "cs408", "english", "politics", "other"].indexOf(subject) === -1) {
      throw new Error("先选一个学科");
    }
    if (!LazyLearnApi.session().loggedIn) throw new Error("先登录懒学账号");

    var limit = Number(body.limit) > 0 ? Math.min(Math.floor(Number(body.limit)), 50) : 6;
    var prefs = null;
    try {
      prefs = await LazyLearnApi.preferences();
    } catch (error) {
      // 偏好读不到不该挡住换题：按整科、默认卷别继续，面板会把薄弱点数量显示为 0。
      prefs = null;
    }

    var examScope = examScopeFor(prefs, subject);
    var weakNames = weakTopicNames(prefs, subject);
    var chapterIds = [];
    if (weakNames.length) {
      try {
        var nodes = await LazyLearnApi.taxonomy(subject, examScope);
        var list = Object.prototype.toString.call(nodes) === "[object Array]" ? nodes : [];
        var seen = {};
        weakNames.forEach(function (name) {
          var hit = matchTaxonomy(name, list);
          if (hit && hit.id && !seen[hit.id]) {
            seen[hit.id] = true;
            chapterIds.push(String(hit.id));
          }
        });
      } catch (error) {
        chapterIds = [];
      }
    }
    chapterIds = chapterIds.slice(0, 50);

    var weakChapters = chapterIds.length;
    var fallback = false;
    var group = await requestPracticeGroup(groupConditions(subject, examScope, chapterIds, limit));
    var ids = ((group && group.questionIds) || []).map(String);
    if (!ids.length && chapterIds.length) {
      // 薄弱点章节里暂时没有题：退回整科再取一次，别让面板空着。
      fallback = true;
      group = await requestPracticeGroup(groupConditions(subject, examScope, [], limit));
      ids = ((group && group.questionIds) || []).map(String);
    }

    var items = ids.length ? await LazyLearnApi.batchQuestions(ids) : [];
    // 选题与题面都拿到了，这次练习请求才算完成；下次「换一组」用新的 requestId。
    practiceRequest = null;
    var url = LazyLearnApi.practiceUrl();
    return {
      subject: subject,
      sessionId: group && group.sessionId ? String(group.sessionId) : "",
      weakTopics: weakNames.length,
      weakChapters: weakChapters,
      fallback: fallback,
      requested: ids.length,
      items: items.map(function (item) {
        return {
          id: item.id,
          stem: item.stem,
          kind: item.kind,
          seq: item.seq,
          optionCount: (item.options || []).length,
        };
      }),
      url: url,
    };
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
    getPreferences: getPreferences,
    practiceGroup: practiceGroup,
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
