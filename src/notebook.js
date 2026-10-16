// notebook.js —— 专题导入：把当前笔记本的脑图层级收成懒学笔记。
// 取数口径来自官方文档：NotebookController.notebookId → MbTopic.notes（根节点）
// → MbBookNote.childNotes 递归；评论只收 TextNote（手写是 PaintNote，插件这版不碰）。
//
// 两种粒度：single = 整本压成一篇；roots = 每个根节点一篇（章节导进来更像要复习的样子）。
var LazyLearnNotebook = (function () {
  var MODE_SINGLE = "single";
  var MODE_ROOTS = "roots";
  // 单篇与整次导入的上限：超了截断/少导，并如实告诉用户，不做静默丢数据。
  var MAX_CHARS = 100000;
  var MAX_TOTAL_CHARS = 400000;
  var MAX_DOCUMENTS = 50;
  var PREVIEW_CHARS = 1200;

  function textOf(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function safe(read, fallback) {
    try {
      var value = read();
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function toArray(value) {
    if (!value) return [];
    if (Object.prototype.toString.call(value) === "[object Array]") return value;
    var size = safe(function () {
      return Number(value.count());
    }, 0);
    var rows = [];
    for (var index = 0; index < size; index += 1) {
      var item = safe(function () {
        return value.objectAtIndex(index);
      }, null);
      if (item !== null && item !== undefined) rows.push(item);
    }
    return rows;
  }

  function noteTitle(note) {
    return textOf(safe(function () {
      return note.noteTitle;
    }, "")).trim();
  }

  function noteExcerpt(note) {
    return textOf(safe(function () {
      return note.excerptText;
    }, "")).trim();
  }

  function noteName(note) {
    return noteTitle(note) || noteExcerpt(note).split("\n")[0].trim() || "未命名笔记";
  }

  function textComments(note) {
    var rows = [];
    toArray(safe(function () {
      return note.comments;
    }, null)).forEach(function (comment) {
      var type = textOf(safe(function () {
        return comment.type;
      }, ""));
      if (type && type !== "TextNote") return;
      var text = textOf(safe(function () {
        return comment.text;
      }, "")).trim();
      // 链接笔记在评论里就是一条 marginnote4app://note/xxx 的地址，对懒学没意义。
      if (!text || text.indexOf("marginnote4app://") === 0) return;
      rows.push(text);
    });
    return rows;
  }

  function indent(depth) {
    return new Array(depth + 1).join("  ");
  }

  function pushLine(context, text) {
    if (context.stopped) return;
    // 记账而不是每行 join 一次：整本笔记本上万行，join 会变成 O(n²)。
    if (context.chars + text.length > MAX_CHARS) {
      context.stopped = true;
      return;
    }
    context.lines.push(text);
    context.chars += text.length + 1;
  }

  function renderNote(note, depth, context) {
    if (context.stopped) return;
    context.count += 1;

    var title = noteTitle(note) || noteExcerpt(note).split("\n")[0];
    if (title) pushLine(context, indent(depth) + "- " + title.replace(/\n/g, " "));

    var excerpt = noteExcerpt(note);
    if (excerpt && excerpt !== title) {
      excerpt.split("\n").forEach(function (line) {
        if (line.trim()) pushLine(context, indent(depth + 1) + "  " + line.trim());
      });
    }

    textComments(note).forEach(function (comment) {
      comment.split("\n").forEach(function (line) {
        if (line.trim()) pushLine(context, indent(depth + 1) + "  " + line.trim());
      });
    });

    toArray(safe(function () {
      return note.childNotes;
    }, null)).forEach(function (child) {
      renderNote(child, depth + 1, context);
    });
  }

  function renderTree(roots, title) {
    var context = { lines: [], count: 0, chars: 0, stopped: false };
    roots.forEach(function (note) {
      renderNote(note, 0, context);
    });

    var body = context.lines.join("\n");
    if (context.stopped) {
      body += "\n\n…（超过 " + MAX_CHARS + " 字，后面的笔记没导进来）";
    }
    return {
      title: title,
      markdown: "# " + title + "\n\n" + body,
      noteCount: context.count,
      truncated: context.stopped,
    };
  }

  function readTopic(addon) {
    var addonWindow = addon ? addon.window : null;
    if (!addonWindow) {
      return { available: false, reason: "插件窗口还没就绪" };
    }

    var studyController = safe(function () {
      return Application.sharedInstance().studyController(addonWindow);
    }, null);
    if (!studyController) {
      return { available: false, reason: "请先打开一个笔记本" };
    }

    var notebookId = textOf(safe(function () {
      return studyController.notebookController.notebookId;
    }, ""));
    if (!notebookId) {
      return { available: false, reason: "还没打开笔记本" };
    }

    var topic = safe(function () {
      return Database.sharedInstance().getNotebookById(notebookId);
    }, null);
    if (!topic) {
      return { available: false, reason: "读不到这个笔记本" };
    }

    return {
      available: true,
      reason: "",
      notebookId: notebookId,
      title: textOf(safe(function () {
        return topic.title;
      }, "")).trim() || "MarginNote 笔记本",
      roots: toArray(safe(function () {
        return topic.notes;
      }, null)),
    };
  }

  function normalizeMode(mode) {
    return mode === MODE_ROOTS ? MODE_ROOTS : MODE_SINGLE;
  }

  // 返回这一趟会写成哪几篇懒学笔记；截断在这里就决定，导入只是照着写。
  function documents(addon, mode) {
    var topic = readTopic(addon);
    if (!topic.available) return topic;

    var wanted = normalizeMode(mode);
    var docs = [];
    var truncated = false;
    var perSection = topic.roots;

    if (wanted === MODE_ROOTS) {
      if (topic.roots.length > MAX_DOCUMENTS) {
        truncated = true;
        perSection = topic.roots.slice(0, MAX_DOCUMENTS);
      }
      perSection.forEach(function (note) {
        docs.push(renderTree([note], noteName(note)));
      });
    } else {
      docs.push(renderTree(topic.roots, topic.title));
    }

    var total = 0;
    var kept = [];
    for (var index = 0; index < docs.length; index += 1) {
      if (total + docs[index].markdown.length > MAX_TOTAL_CHARS) {
        truncated = true;
        break;
      }
      total += docs[index].markdown.length;
      kept.push(docs[index]);
      if (docs[index].truncated) truncated = true;
    }

    return {
      available: true,
      reason: "",
      mode: wanted,
      notebookId: topic.notebookId,
      title: topic.title,
      rootCount: topic.roots.length,
      documentCount: kept.length,
      noteCount: kept.reduce(function (sum, doc) {
        return sum + doc.noteCount;
      }, 0),
      truncated: truncated,
      documents: kept,
    };
  }

  function preview(addon, mode) {
    var result = documents(addon, mode);
    if (!result.available) return result;

    var first = result.documents.length ? result.documents[0].markdown : "";
    return {
      available: true,
      reason: "",
      mode: result.mode,
      notebookId: result.notebookId,
      title: result.title,
      rootCount: result.rootCount,
      documentCount: result.documentCount,
      noteCount: result.noteCount,
      truncated: result.truncated,
      chars: first.length,
      titles: result.documents.slice(0, 20).map(function (doc) {
        return doc.title;
      }),
      preview: first.length > PREVIEW_CHARS ? first.slice(0, PREVIEW_CHARS) + "…" : first,
    };
  }

  return {
    documents: documents,
    preview: preview,
    MODE_SINGLE: MODE_SINGLE,
    MODE_ROOTS: MODE_ROOTS,
  };
})();
