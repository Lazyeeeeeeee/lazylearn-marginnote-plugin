// 10 秒冒烟：node scripts/smoke-bridge.mjs
// 在 Node 里用假的原生对象跑一遍桥命令表——不需要 MarginNote 真机，
// 验的是「选区怎么读、请求发去哪、token 存哪、SSE 怎么拆」这几件事的接线。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "src/lazylearn.js",
  "src/tutor.js",
  "src/notebook.js",
  "src/pullcards.js",
  "src/selection.js",
  "src/WebBridgeCommands.js",
];

const preferences = new Map();
const requests = [];
const uploads = [];
const createdNotes = [];
const undoLabels = [];
const refreshedTopics = [];
const practiceGroupCalls = [];
const batchCalls = [];
let conversationSeq = 0;

class FakeData {
  constructor(text, capacity) {
    this.text_ = String(text);
    this.parts = [String(text)];
    this.byteLength = String(text).length;
    this.capacity = capacity || 0;
    this.binary = text === "PNGDATA";
  }

  length() {
    return this.byteLength;
  }

  appendData(other) {
    this.parts.push(other);
    this.byteLength += typeof other.length === "function" ? other.length() : 0;
  }

  bytes() {
    return this.parts
      .map((part) => (typeof part === "string" ? part : part.binary ? "<<binary>>" : part.text_))
      .join("");
  }
}

function stubJson(status, body) {
  return { status, json: () => body, text: () => JSON.stringify(body) };
}

function stubText(status, raw) {
  return { status, json: () => null, text: () => raw };
}

const sseAnswer = [
  'event: user\ndata: {"id":"msg-1"}',
  'event: delta\ndata: {"content":"死锁要同时满足四个条件：互斥"}',
  'event: done\ndata: {"content":"死锁要同时满足四个条件：互斥、请求与保持、不可剥夺、循环等待"}',
].join("\n\n") + "\n\n";

const selectionText = "死锁产生的四个必要条件\n互斥、请求与保持、不可剥夺、循环等待";
// focusNote 与笔记本里的第一条就是同一张笔记（真机上也是），所以注释与子笔记都挂它身上。
const noteOne = {
  noteId: "note-1",
  noteTitle: "死锁",
  notebookId: "nb-1",
  excerptText: "死锁产生的四个必要条件",
  comments: [
    { type: "TextNote", text: "考点：四个条件要背全" },
    { type: "PaintNote", paint: "hash-1" },
  ],
  childNotes: [
    { noteId: "note-2", noteTitle: "循环等待", excerptText: "每个进程都在等下一个进程持有的资源" },
  ],
};
const focusNote = noteOne;
const fakeNotebook = {
  topicId: "nb-1",
  title: "操作系统 · 第五章",
  notes: [
    noteOne,
    { noteId: "note-3", noteTitle: "缺页中断", excerptText: "要访问的页不在内存，触发缺页中断" },
  ],
};
const studyController = {
  readerController: { currentDocumentController: { selectionText, document: { title: "操作系统" } } },
  notebookController: { focusNote, notebookId: "nb-1" },
};
const addonWindow = { name: "window" };

const context = vm.createContext({
  console,
  JSON,
  Date,
  Math,
  Promise,
  String,
  Number,
  Object,
  Array,
  Error,
  encodeURIComponent,
  NSNull: class NSNull {},
  NSUserDefaults: {
    standardUserDefaults: () => ({
      objectForKey: (key) => (preferences.has(key) ? preferences.get(key) : null),
      setObjectForKey: (value, key) => preferences.set(key, value),
      removeObjectForKey: (key) => preferences.delete(key),
    }),
  },
  Application: {
    sharedInstance: () => ({
      studyController: (target) => (target === addonWindow ? studyController : null),
      refreshAfterDBChanged: (topicId) => {
        refreshedTopics.push(topicId);
      },
    }),
  },
  UndoManager: {
    sharedInstance: () => ({
      undoGrouping: (label, topicId, fn) => {
        undoLabels.push({ label, topicId });
        fn();
      },
    }),
  },
  Database: {
    sharedInstance: () => ({
      getNotebookById: (topicId) => (topicId === "nb-1" ? fakeNotebook : null),
      getMediaByHash: (hash) => (hash === "hash-1" ? new FakeData("PNGDATA") : null),
      createNoteWithTitleTopicid: (title, topicId) => {
        const note = {
          title,
          topicId,
          comments: [],
          appendTextComment(text) {
            note.comments.push(text);
          },
        };
        createdNotes.push(note);
        return note;
      },
    }),
  },
  NSData: {
    dataWithStringEncoding: (text) => new FakeData(String(text)),
  },
  NSMutableData: {
    dataWithCapacity: (capacity) => new FakeData("", capacity),
  },
  NSURL: { URLWithString: (value) => ({ value }) },
  NSMutableURLRequest: {
    requestWithURL: (url) => {
      const request = { url: url.value, headers: {}, method: "GET" };
      request.setHTTPMethod = (method) => {
        request.method = method;
      };
      request.setTimeoutInterval = (seconds) => {
        request.timeout = seconds;
      };
      request.setAllHTTPHeaderFields = (headers) => {
        request.headers = headers;
      };
      request.setHTTPBody = (body) => {
        request.body = body;
      };
      return request;
    },
  },
  NSOperationQueue: { mainQueue: () => ({ name: "main" }) },
  NSURLConnection: {
    // 上传那条路不走 LazyLearnNetwork：直接把拼好的 multipart body 抓下来验。
    sendAsynchronousRequestQueueCompletionHandler: (request, queue, handler) => {
      uploads.push(request);
      handler(
        { statusCode: () => 200 },
        { length: () => 1, base64Encoding: () => "", toString: () => "" },
        null,
      );
    },
  },
  NSJSONSerialization: {
    JSONObjectWithDataOptions: () =>
      uploads.length
        ? { objectKey: "chat/u1/abc.png", url: "https://cdn.lazylearn.cn/chat/u1/abc.png", contentType: "image/png", filename: "marginnote.png" }
        : null,
  },
  LazyLearnNetwork: {
    fetch: async (url, options) => {
      requests.push({ url, options });
      const body = options.json ? JSON.parse(JSON.stringify(options.json)) : {};
      if (url.endsWith("/api/auth/login")) return stubJson(200, { ok: true, token: "sess-1" });
      if (url.endsWith("/api/auth/me")) return stubJson(200, { username: "ivan", nickname: "懒学同学" });
      if (url.endsWith("/api/recite/cards")) {
        if ((options.method || "GET") === "POST") {
          return stubJson(200, { id: "concept-1", front: body.front, back: body.back, externalId: body.externalId });
        }
        return stubJson(200, {
          items: [
            { id: "card-1", front: "死锁的必要条件", back: "互斥、请求与保持、不可剥夺、循环等待" },
            { id: "card-2", front: "缺页中断", back: "要访问的页不在内存" },
            { id: "card-3", front: "内存碎片", back: "空闲块太小，无法满足分配请求" },
          ],
          total: 3,
          inDeck: 3,
        });
      }
      if (url.includes("/api/search/questions")) {
        return stubJson(200, { source: "text", items: [{ id: "q1", stem: "死锁的必要条件", kind: "choice", seq: 3 }] });
      }
      if (url.endsWith("/api/me/preferences")) {
        return stubJson(200, {
          enabledSubjects: ["cs408", "math", "english"],
          weakTopics: ["旧列表"],
          weakTopicsBySubject: {
            cs408: ["进程与线程", "内存管理"],
            math: ["极限"],
            english: [],
            other: ["自定义章节"],
          },
          mathCategory: "math2",
          englishTrack: "english1",
        });
      }
      if (url.endsWith("/api/taxonomy")) {
        const nodes = {
          cs408: [
            { id: "cs408-process", name: "进程与线程", level: 1, subject: "cs408" },
            { id: "cs408-memory", name: "内存管理", level: 1, subject: "cs408" },
            { id: "cs408-deadlock", name: "死锁", level: 2, subject: "cs408" },
          ],
          math: [{ id: "math-limit", name: "极限", level: 1, subject: "math" }],
          english: [{ id: "english:reading", name: "阅读", level: 1, subject: "english" }],
          other: [{ id: "other-ch1", name: "自定义章节", level: 1, subject: "other" }],
        };
        return stubJson(200, nodes[options.search?.subject] || []);
      }
      if (url.endsWith("/api/questions/practice-group")) {
        practiceGroupCalls.push(body);
        if (body.subject === "other" && body.chapterIds.length) {
          return stubJson(200, { questionIds: [], sessionId: body.requestId });
        }
        if (body.subject === "other") {
          return stubJson(200, { questionIds: ["q3"], sessionId: body.requestId });
        }
        return stubJson(200, { questionIds: ["q2", "q1"], sessionId: body.requestId });
      }
      if (url.endsWith("/api/questions/batch")) {
        batchCalls.push(body);
        const pool = [
          { id: "q1", stem: "死锁的必要条件", kind: "single_choice", seq: 3, options: [{ key: "A" }, { key: "B" }] },
          { id: "q2", stem: "缺页中断", kind: "solve", seq: 4, options: [] },
          { id: "q3", stem: "文件系统的空闲块", kind: "multiple_choice", seq: 5, options: [{ key: "A" }] },
        ];
        return stubJson(200, { items: pool.filter((item) => body.ids.includes(item.id)) });
      }
      if (url.includes("/messages") && url.includes("/api/conversations/")) return stubText(200, sseAnswer);
      if (url.endsWith("/api/conversations")) {
        conversationSeq += 1;
        return stubJson(200, { id: `conv-${conversationSeq}`, title: body.title });
      }
      if (url.endsWith("/api/notes")) return stubJson(200, { id: "note-1", title: body.title, body: body.body });
      return stubJson(404, { detail: "Not Found" });
    },
  },
});

for (const relative of sourceFiles) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const commands = context.__MN_WEB_BRIDGE_COMMANDS_GLOBAL__.commands;
const bridgeContext = { addon: { window: addonWindow }, controller: {}, closePanel: () => {} };
// 建会话只在「恰好是 /api/conversations」的 POST 上数一次：消息接口的路径带着它当前缀。
const createConversationCalls = () =>
  requests.filter((item) => item.url.endsWith("/api/conversations") && item.options.method === "POST").length;

// ---------- 选区 ----------
const picked = commands.getSelection(bridgeContext);
assert.equal(picked.available, true);
assert.equal(picked.excerpt, selectionText);
assert.equal(picked.noteId, "note-1");
assert.equal(picked.documentTitle, "操作系统");
assert.equal(picked.pictureCount, 1, "手写/图片评论数要带上");
assert.equal(picked.pictureHash, "hash-1");

// ---------- 登录 / 会话 ----------
assert.equal(commands.getSession().loggedIn, false);
await assert.rejects(() => commands.createCard(bridgeContext, { front: "a", back: "b" }), /先登录/);

const loggedIn = await commands.login(bridgeContext, { username: "ivan", password: "pw" });
assert.equal(loggedIn.loggedIn, true);
assert.equal(loggedIn.profile.nickname, "懒学同学");
assert.equal(preferences.get("lazylearn_token"), "sess-1");
assert.equal(requests.find((item) => item.url.endsWith("/api/auth/me")).options.headers.Authorization, "Bearer sess-1");

// ---------- 制卡 ----------
const saved = await commands.createCard(bridgeContext, {
  front: "死锁的必要条件",
  back: "互斥、请求保持、不剥夺、循环等待",
  subject: "cs408",
  externalId: "marginnote:note:note-1",
});
assert.equal(saved.card.id, "concept-1");
assert.equal(saved.cardUrl, "https://lazylearn.cn/study/recite");
const cardCall = requests.find((item) => item.url.endsWith("/api/recite/cards"));
assert.equal(cardCall.options.method, "POST");
assert.equal(cardCall.options.json.subject, "cs408", "新版建卡必须带明确学科");
assert.equal(cardCall.options.json.externalId, "marginnote:note:note-1");

// ---------- 找题 ----------
const found = await commands.searchQuestions(bridgeContext, { q: "死锁", limit: 5 });
assert.equal(found.items[0].id, "q1");
assert.equal(found.items[0].url, "https://lazylearn.cn/study/practice");

// ---------- 偏好 / 个性化题组 ----------
const prefs = await commands.getPreferences();
assert.deepEqual([...prefs.enabledSubjects], ["cs408", "math", "english"]);
assert.equal(prefs.mathCategory, "math2");
assert.equal(prefs.englishTrack, "english1");
assert.deepEqual([...prefs.weakTopicsBySubject.cs408], ["进程与线程", "内存管理"]);

const group = await commands.practiceGroup(bridgeContext, { subject: "cs408", limit: 6 });
const firstGroupCall = practiceGroupCalls[0];
assert.equal(firstGroupCall.subject, "cs408");
assert.equal(firstGroupCall.examScope, undefined, "408 不带卷别");
assert.deepEqual([...firstGroupCall.chapterIds], ["cs408-process", "cs408-memory"]);
assert.equal(firstGroupCall.limit, 6);
assert.match(firstGroupCall.requestId, /^mn-/);
assert.equal(group.sessionId, firstGroupCall.requestId);
assert.equal(group.weakTopics, 2);
assert.equal(group.weakChapters, 2);
assert.equal(group.fallback, false);
assert.deepEqual([...group.items.map((item) => item.id)], ["q2", "q1"], "题面要按选题顺序返回");
assert.equal(group.items[0].optionCount, 0);
assert.equal(group.items[1].optionCount, 2);
assert.equal(group.url, "https://lazylearn.cn/study/practice");
assert.deepEqual([...batchCalls[0].ids], ["q2", "q1"]);

const mathGroup = await commands.practiceGroup(bridgeContext, { subject: "math", limit: 6 });
const mathCall = practiceGroupCalls[1];
assert.equal(mathCall.examScope, "math2");
assert.deepEqual([...mathCall.chapterIds], ["math-limit"]);
assert.notEqual(mathCall.requestId, firstGroupCall.requestId, "成功后换一组要用新的 requestId");
assert.equal(mathGroup.items.length, 2);

const englishGroup = await commands.practiceGroup(bridgeContext, { subject: "english", limit: 1 });
const englishCall = practiceGroupCalls[2];
assert.equal(englishCall.examScope, "english1");
assert.deepEqual([...englishCall.chapterIds], []);
assert.equal(englishCall.limit, 1, "英语按整篇取，一篇就是一组");
assert.equal(englishGroup.items.length, 2);

// 薄弱点章节里没题时退回整科，不能让面板空着。
const fallbackGroup = await commands.practiceGroup(bridgeContext, { subject: "other", limit: 6 });
const otherCalls = practiceGroupCalls.filter((item) => item.subject === "other");
assert.equal(otherCalls.length, 2);
assert.deepEqual([...otherCalls[0].chapterIds], ["other-ch1"]);
assert.deepEqual([...otherCalls[1].chapterIds], []);
assert.equal(fallbackGroup.fallback, true);
assert.equal(fallbackGroup.weakChapters, 1);
assert.deepEqual([...fallbackGroup.items.map((item) => item.id)], ["q3"]);

await assert.rejects(
  () => commands.practiceGroup(bridgeContext, { subject: "unknown" }),
  /先选一个学科/,
);

// ---------- 助教：SSE 解析 ----------
const failureFrame = context.LazyLearnTutor.parseAnswer('event: error\ndata: {"detail":"额度用完了"}\n\n');
assert.equal(failureFrame.failed, true);
assert.equal(failureFrame.detail, "额度用完了");

const asked = await commands.askTutor(bridgeContext, { prompt: "讲清楚死锁" });
assert.equal(asked.conversationId, "conv-1");
assert.match(asked.answer, /循环等待/);
assert.equal(createConversationCalls(), 1, "第一次问才建会话");

// 追问复用同一个会话；重置之后才再建一个。
await commands.askTutor(bridgeContext, { prompt: "再举一个例子" });
assert.equal(createConversationCalls(), 1);
assert.equal(commands.getTutorSession().hasConversation, true);

commands.resetTutor();
assert.equal(commands.getTutorSession().hasConversation, false);
await commands.askTutor(bridgeContext, { prompt: "换一段再问" });
assert.equal(createConversationCalls(), 2);

const messageCall = requests.find((item) => item.url.includes("/api/conversations/conv-1/messages"));
assert.equal(messageCall.options.timeout, 120, "对话要按生成时间给足超时");
assert.equal(messageCall.options.headers.Authorization, "Bearer sess-1");

// ---------- 带图问助教（PaintNote → NSData → multipart → media） ----------
const withImage = await commands.askTutor(bridgeContext, {
  prompt: "我写的这一步错在哪",
  imageHash: "hash-1",
});
assert.match(withImage.answer, /循环等待/);

const upload = uploads[uploads.length - 1];
assert.equal(upload.url, "https://lazylearn.cn/api/media?scope=chat");
assert.equal(upload.method, "POST");
assert.equal(upload.headers.Authorization, "Bearer sess-1");
assert.match(upload.headers["Content-Type"], /^multipart\/form-data; boundary=----LazyLearnBoundary/);
const multipart = upload.body.bytes();
assert.match(multipart, /name="file"; filename="marginnote\.png"/);
assert.match(multipart, /Content-Type: image\/png/);
assert.match(multipart, /<<binary>>/, "图片二进制要进 body，不能只发个头");
assert.match(multipart, /--\r\n$/, "结尾要有收尾边界");

const withImageMessage = requests[requests.length - 1];
assert.equal(withImageMessage.options.json.media.length, 1);
assert.equal(withImageMessage.options.json.media[0].objectKey, "chat/u1/abc.png");
assert.equal(withImageMessage.options.json.media[0].filename, "marginnote.png");

await assert.rejects(
  () => commands.askTutor(bridgeContext, { prompt: "带一张读不到的图", imageHash: "hash-404" }),
  /读不到这张图/,
);

// ---------- 从懒学取回卡（懒学 → 脑图） ----------
// 新版清单接口返回整份候选，不再按 limit 截断；「一次取几张」由插件本地兑现。
const pullPreview = await commands.previewPullCards(bridgeContext, { scope: "deck", limit: 2 });
assert.equal(pullPreview.available, true);
assert.equal(pullPreview.total, 3);
assert.equal(pullPreview.pending, 3);
assert.equal(pullPreview.batch, 2);
assert.deepEqual([...pullPreview.titles], ["死锁的必要条件", "缺页中断"]);
assert.equal(createdNotes.length, 0, "只看不写");

const pulled = await commands.pullCards(bridgeContext, { scope: "deck", limit: 1 });
assert.equal(pulled.created, 1, "一次最多取一张");
assert.equal(pulled.pending, 2, "剩下的留到下一批");
assert.equal(createdNotes.length, 1);
assert.equal(createdNotes[0].title, "死锁的必要条件");
assert.equal(createdNotes[0].topicId, "nb-1");
assert.match(createdNotes[0].comments[0], /循环等待/, "背面要写成评论");
assert.ok(undoLabels.some((item) => item.label === "从懒学取回卡片"), "整批要能一次撤销");
assert.ok(refreshedTopics.includes("nb-1"), "写完要刷新脑图");
assert.match(String(preferences.get("lazylearn_imported_nb-1")), /card-1/);
assert.doesNotMatch(String(preferences.get("lazylearn_imported_nb-1")), /card-2/, "没取的卡不记账");

const pulledRest = await commands.pullCards(bridgeContext, { scope: "deck", limit: 20 });
assert.equal(pulledRest.created, 2);
assert.equal(pulledRest.pending, 0);
assert.equal(createdNotes.length, 3);
assert.equal(createdNotes[1].title, "缺页中断");
assert.equal(createdNotes[2].title, "内存碎片");

const replay = await commands.pullCards(bridgeContext, { scope: "deck" });
assert.equal(replay.created, 0, "取过的卡不该再来一遍");
assert.equal(replay.skipped, 3);
assert.equal(createdNotes.length, 3);

const pullScope = requests.filter((item) => item.url.endsWith("/api/recite/cards") && (item.options.method || "GET") === "GET").pop();
assert.equal(pullScope.options.search.scope, "deck");
assert.equal(pullScope.options.search.limit, "20");

await commands.previewPullCards(bridgeContext, { scope: "mine", limit: 50 });
const pullScopeMine = requests.filter((item) => item.url.endsWith("/api/recite/cards") && (item.options.method || "GET") === "GET").pop();
assert.equal(pullScopeMine.options.search.scope, "mine");
assert.equal(pullScopeMine.options.search.limit, "50");

// ---------- 让懒懒出卡（cardsRequest） ----------
const cardRun = await commands.makeCards(bridgeContext, {
  excerpt: "死锁产生的四个必要条件",
  noteTitle: "死锁",
  subject: "cs408",
  limit: 6,
});
assert.equal(cardRun.url, "https://lazylearn.cn/study/recite");
assert.match(cardRun.answer, /循环等待/);
assert.notEqual(cardRun.conversationId, asked.conversationId, "制卡另起一趟会话，别污染助教那条");
const cardRunMessage = requests[requests.length - 1];
assert.equal(cardRunMessage.options.json.cardsRequest, true);
assert.equal(cardRunMessage.options.json.subject, "cs408");
assert.match(cardRunMessage.options.json.content, /最多 6 张/);
assert.match(cardRunMessage.options.json.content, /死锁产生的四个必要条件/);

await assert.rejects(() => commands.makeCards(bridgeContext, { excerpt: "   " }), /选中一段材料/);

// ---------- 存笔记 ----------
const note = await commands.saveNote(bridgeContext, { title: "MarginNote · 死锁", body: "四个条件" });
assert.equal(note.id, "note-1");
assert.equal(note.url, "https://lazylearn.cn/study/wiki");

// ---------- 专题导入：整本一篇 ----------
const preview = commands.previewNotebook(bridgeContext, {});
assert.equal(preview.available, true);
assert.equal(preview.title, "操作系统 · 第五章");
assert.equal(preview.noteCount, 3, "子笔记也算进来");
assert.equal(preview.documentCount, 1);
assert.deepEqual([...preview.titles], ["操作系统 · 第五章"]);
assert.match(preview.preview, /- 死锁/);
assert.match(preview.preview, /考点：四个条件要背全/);
assert.match(preview.preview, /循环等待/);
assert.ok(!preview.preview.includes("hash-1"), "手写评论不进正文");

const imported = await commands.importNotebook(bridgeContext, {});
assert.equal(imported.count, 1);
assert.equal(imported.noteCount, 3);
assert.equal(imported.url, "https://lazylearn.cn/study/wiki");
const noteCall = requests[requests.length - 1];
assert.equal(noteCall.url, "https://lazylearn.cn/api/notes");
assert.match(noteCall.options.json.title, /操作系统 · 第五章/);
assert.match(noteCall.options.json.body, /循环等待/);

// ---------- 专题导入：每个根节点一篇 ----------
const splitPreview = commands.previewNotebook(bridgeContext, { mode: "roots" });
assert.equal(splitPreview.documentCount, 2);
assert.equal(splitPreview.noteCount, 3);
assert.deepEqual([...splitPreview.titles], ["死锁", "缺页中断"]);

const before = requests.filter((item) => item.url.endsWith("/api/notes")).length;
const splitImport = await commands.importNotebook(bridgeContext, { mode: "roots" });
assert.equal(splitImport.count, 2);
assert.deepEqual([...splitImport.titles], ["死锁", "缺页中断"]);
const noteCalls = requests.filter((item) => item.url.endsWith("/api/notes")).slice(before);
assert.equal(noteCalls.length, 2, "两篇就是两次写入");
assert.equal(noteCalls[0].options.json.title, "死锁");
assert.match(noteCalls[0].options.json.body, /循环等待/);
assert.equal(noteCalls[1].options.json.title, "缺页中断");
assert.match(noteCalls[1].options.json.body, /缺页中断/);

await commands.logout();
assert.equal(commands.getSession().loggedIn, false);
assert.equal(commands.getTutorSession().hasConversation, false, "退出登录要清掉本地的助教会话");

console.log("✓ bridge smoke ok");
