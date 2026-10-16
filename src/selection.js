// selection.js —— 从当前窗口读出「用户在文档里选中的文字」与「当前焦点的脑图笔记」。
// 取值口径来自官方文档《脑图与选区》：studyController.window → readerController.currentDocumentController。
var LazyLearnSelection = (function () {
  function textOf(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function safeRead(read, fallback) {
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
    var size = safeRead(function () {
      return Number(value.count());
    }, 0);
    var rows = [];
    for (var index = 0; index < size; index += 1) {
      var item = safeRead(function () {
        return value.objectAtIndex(index);
      }, null);
      if (item !== null && item !== undefined) rows.push(item);
    }
    return rows;
  }

  // 手写/图片评论（PaintNote）带的是媒体哈希，取数据走 Database.getMediaByHash。
  // 摘录图（excerptPic）那份字典的结构文档没说清，所以只认这一条有据可依的路。
  function paintHashes(note) {
    if (!note) return [];
    var hashes = [];
    toArray(safeRead(function () {
      return note.comments;
    }, null)).forEach(function (comment) {
      var type = textOf(safeRead(function () {
        return comment.type;
      }, ""));
      if (type !== "PaintNote") return;
      var hash = textOf(safeRead(function () {
        return comment.paint;
      }, "")).trim();
      if (hash) hashes.push(hash);
    });
    return hashes;
  }

  function read(addon) {
    var addonWindow = addon ? addon.window : null;
    if (!addonWindow) {
      return { available: false, reason: "插件窗口还没就绪", excerpt: "" };
    }

    var studyController = safeRead(function () {
      return Application.sharedInstance().studyController(addonWindow);
    }, null);
    if (!studyController) {
      return { available: false, reason: "请先打开一个笔记本", excerpt: "" };
    }

    var docController = safeRead(function () {
      return studyController.readerController.currentDocumentController;
    }, null);
    var focusNote = safeRead(function () {
      return studyController.notebookController.focusNote;
    }, null);

    var excerpt = docController ? textOf(safeRead(function () { return docController.selectionText; }, "")) : "";
    var noteExcerpt = focusNote ? textOf(safeRead(function () { return focusNote.excerptText; }, "")) : "";
    if (!excerpt.trim()) excerpt = noteExcerpt;

    var pictures = paintHashes(focusNote);
    return {
      available: true,
      reason: "",
      excerpt: excerpt,
      pictureCount: pictures.length,
      pictureHash: pictures.length ? pictures[0] : "",
      noteId: focusNote ? textOf(safeRead(function () { return focusNote.noteId; }, "")) : "",
      noteTitle: focusNote ? textOf(safeRead(function () { return focusNote.noteTitle; }, "")) : "",
      notebookId: focusNote ? textOf(safeRead(function () { return focusNote.notebookId; }, "")) : "",
      documentTitle: docController
        ? textOf(safeRead(function () { return docController.document.title; }, ""))
        : "",
    };
  }

  return { read: read };
})();
