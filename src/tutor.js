// tutor.js —— 浮窗助教：把选区/追问交给懒学对话，拿回整段回答。
// 对话接口回 text/event-stream，但服务端是「完整生成后一次性 yield」，
// 所以照小程序的同口径：整段读回再按 SSE 帧取 delta/done 的 content。
var LazyLearnTutor = (function () {
  var KEY_CONVERSATION = "lazylearn_tutor_conversation";

  function parseAnswer(text) {
    var frames = String(text || "").replace(/\r\n/g, "\n").split("\n\n");
    var content = "";
    for (var i = 0; i < frames.length; i += 1) {
      var lines = frames[i].split("\n");
      var event = "";
      var data = "";
      for (var j = 0; j < lines.length; j += 1) {
        var line = lines[j];
        if (line.indexOf("event:") === 0) event = line.slice(6).trim();
        else if (line.indexOf("data:") === 0) data += line.slice(5).trim();
      }
      if (!data) continue;

      var payload = null;
      try {
        payload = JSON.parse(data);
      } catch (error) {
        continue; // 非 JSON 的 data 帧（心跳/注释）跳过
      }

      if (event === "error") {
        return {
          content: "",
          failed: true,
          detail: payload && payload.detail ? String(payload.detail) : "讲解生成失败",
        };
      }
      if (event === "delta" || event === "done") {
        var piece = payload && payload.content ? String(payload.content) : "";
        // delta 与 done 是同一份全文，取长的那个就是最终正文。
        if (piece.length > content.length) content = piece;
      }
    }
    return { content: content, failed: false, detail: "" };
  }

  function conversationId() {
    return LazyLearnApi.read(KEY_CONVERSATION);
  }

  function reset() {
    LazyLearnApi.clear(KEY_CONVERSATION);
    return { conversationId: "" };
  }

  async function ensureConversation(title) {
    var existing = conversationId();
    if (existing) return existing;
    var created = await LazyLearnApi.createConversation(title);
    if (!created) throw new Error("没能建起对话，请重试");
    LazyLearnApi.write(KEY_CONVERSATION, created);
    return created;
  }

  async function ask(prompt, options) {
    var text = String(prompt || "").trim();
    if (!text) throw new Error("先说点什么");

    var opts = options || {};
    var convId = opts.newConversation ? "" : conversationId();
    if (!convId) convId = await ensureConversation(opts.title || text);

    // 带图先传图：服务端认的是上传回来的 objectKey，不是本地那份 NSData。
    var media = [];
    if (opts.imageHash) {
      media.push(await LazyLearnApi.uploadNoteImage(opts.imageHash));
    }

    var raw = await LazyLearnApi.askTutor(convId, text, {
      cardsRequest: opts.cardsRequest,
      subject: opts.subject,
      media: media,
    });
    var answer = parseAnswer(raw);
    if (answer.failed) throw new Error(answer.detail);
    if (!answer.content) throw new Error("讲解生成失败，请重试");
    return { conversationId: convId, answer: answer.content };
  }

  return {
    ask: ask,
    reset: reset,
    conversationId: conversationId,
    parseAnswer: parseAnswer,
  };
})();
