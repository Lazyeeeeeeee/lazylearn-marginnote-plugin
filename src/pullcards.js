// pullcards.js —— 反向：把懒学的闪卡写成 MarginNote 卡片。
//
// 建卡用官方文档里最省事的那条口：`Database.createNoteWithTitleTopicid(title, topicid)`
// （不像 `Note.createWithTitleNotebookDocument` 那样非得手里有文档）。正面当标题，
// 背面当一条文本评论；整批包在一个 undoGrouping 里，用户 Cmd+Z 能一次撤回。
//
// 去重：每张卡在懒学有稳定 id，取回过的 id 记在插件的 NSUserDefaults 里（按笔记本分开），
// 再点一次只会取新的，不会把同一张卡重复写进脑图。
var LazyLearnPull = (function () {
  var IMPORTED_KEY_PREFIX = "lazylearn_imported_";
  var MAX_REMEMBER = 2000;
  var DEFAULT_LIMIT = 20;

  function readImported(notebookId) {
    var raw = LazyLearnApi.read(IMPORTED_KEY_PREFIX + notebookId);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Object.prototype.toString.call(parsed) === "[object Array]" ? parsed.map(String) : [];
    } catch (error) {
      return [];
    }
  }

  function writeImported(notebookId, ids) {
    LazyLearnApi.write(IMPORTED_KEY_PREFIX + notebookId, JSON.stringify(ids.slice(-MAX_REMEMBER)));
  }

  function notebookIdOf(addon) {
    var addonWindow = addon ? addon.window : null;
    if (!addonWindow) return "";
    try {
      var studyController = Application.sharedInstance().studyController(addonWindow);
      if (!studyController) return "";
      return String(studyController.notebookController.notebookId || "");
    } catch (error) {
      return "";
    }
  }

  function normalizeScope(scope) {
    if (scope === "mine" || scope === "all") return scope;
    return "deck";
  }

  function normalizeLimit(limit) {
    var value = Number(limit);
    if (!value || value < 1) return DEFAULT_LIMIT;
    return Math.min(Math.floor(value), 50);
  }

  async function fetchCards(options) {
    if (!LazyLearnApi.session().loggedIn) throw new Error("先登录懒学账号");
    var opts = options || {};
    var data = await LazyLearnApi.listCards({
      scope: normalizeScope(opts.scope),
      limit: normalizeLimit(opts.limit),
    });
    var items = (data && data.items) || [];
    return items.filter(function (item) {
      return item && item.id && String(item.front || "").trim();
    });
  }

  function splitNew(items, imported) {
    var seen = {};
    imported.forEach(function (id) {
      seen[id] = true;
    });
    var fresh = [];
    var skipped = 0;
    items.forEach(function (item) {
      if (seen[String(item.id)]) skipped += 1;
      else fresh.push(item);
    });
    return { fresh: fresh, skipped: skipped };
  }

  // 只读：告诉面板「懒学上有几张、这张笔记本还差几张」。
  async function preview(addon, options) {
    var notebookId = notebookIdOf(addon);
    if (!notebookId) return { available: false, reason: "请先打开一个笔记本" };

    var items = await fetchCards(options);
    var imported = readImported(notebookId);
    var split = splitNew(items, imported);
    return {
      available: true,
      reason: "",
      notebookId: notebookId,
      total: items.length,
      pending: split.fresh.length,
      skipped: split.skipped,
      titles: split.fresh.slice(0, 20).map(function (item) {
        return String(item.front || "").slice(0, 60);
      }),
    };
  }

  async function pull(addon, options) {
    var notebookId = notebookIdOf(addon);
    if (!notebookId) throw new Error("请先打开一个笔记本");

    var items = await fetchCards(options);
    var imported = readImported(notebookId);
    var split = splitNew(items, imported);
    if (!split.fresh.length) {
      return { notebookId: notebookId, total: items.length, created: 0, skipped: split.skipped, failed: 0, titles: [] };
    }

    var database = Database.sharedInstance();
    var created = [];
    var failed = 0;

    UndoManager.sharedInstance().undoGrouping("从懒学取回卡片", notebookId, function () {
      split.fresh.forEach(function (item) {
        try {
          var note = database.createNoteWithTitleTopicid(String(item.front || "").slice(0, 200), notebookId);
          if (!note) {
            failed += 1;
            return;
          }
          var back = String(item.back || "").trim();
          if (back) note.appendTextComment(back);
          imported.push(String(item.id));
          created.push(String(item.front || ""));
        } catch (error) {
          failed += 1;
        }
      });
    });

    Application.sharedInstance().refreshAfterDBChanged(notebookId);
    writeImported(notebookId, imported);

    return {
      notebookId: notebookId,
      total: items.length,
      created: created.length,
      skipped: split.skipped,
      failed: failed,
      titles: created.slice(0, 20),
    };
  }

  // 换笔记本时看的是各自那本账，所以这里带 notebookId。
  function importedCount(addon) {
    var notebookId = notebookIdOf(addon);
    return notebookId ? readImported(notebookId).length : 0;
  }

  return {
    preview: preview,
    pull: pull,
    importedCount: importedCount,
    readImported: readImported,
  };
})();
