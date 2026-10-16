import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { askTutor, getSelection, getSession, resetTutor, saveNote } from "../lib/pluginApi";
import { normalizeExcerpt } from "../lib/cardDraft.mjs";
import { usePanelShow } from "../lib/usePanelShow";

const CONTEXT_CHARS = 2000;

const PRESETS = [
  {
    id: "explain",
    label: "讲清楚这段",
    build: (excerpt) => `讲清楚这段，按考研的讲法拆步骤：\n\n${excerpt}`,
  },
  {
    id: "exam",
    label: "总结考点",
    build: (excerpt) => `这段在考研里怎么考？总结考点、常见陷阱和记法：\n\n${excerpt}`,
  },
  {
    id: "quiz",
    label: "出一道检验题",
    build: (excerpt) => `根据这段出一道检验题，先别给答案：\n\n${excerpt}`,
  },
];

function contextOf(selection) {
  const excerpt = normalizeExcerpt(selection?.excerpt);
  return excerpt.length > CONTEXT_CHARS ? `${excerpt.slice(0, CONTEXT_CHARS)}…` : excerpt;
}

export default function TutorPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [selection, setSelection] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [attachImage, setAttachImage] = useState(false);
  const [answer, setAnswer] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);

  const refreshSession = useCallback(async () => {
    try {
      const session = await getSession();
      setLoggedIn(Boolean(session?.loggedIn));
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  const readSelection = useCallback(async () => {
    try {
      const picked = await getSelection();
      setSelection(picked);
      if (picked && !picked.available) {
        setError(picked.reason || "读不到当前选区");
      }
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  const handlePanelShow = useCallback(() => {
    refreshSession();
    readSelection();
  }, [readSelection, refreshSession]);

  usePanelShow(handlePanelShow);

  useEffect(() => {
    refreshSession();
    readSelection();
  }, [readSelection, refreshSession]);

  function fillPreset(preset) {
    const excerpt = contextOf(selection);
    if (!excerpt) {
      setError("先在 PDF 里选中一段文字，或用下面的输入框自己问");
      return;
    }
    setError("");
    setPrompt(preset.build(excerpt));
  }

  async function handleAsk() {
    if (!prompt.trim()) {
      setError("先写要问什么");
      return;
    }
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      const result = await askTutor(prompt, {
        title: selection?.noteTitle || prompt.trim().slice(0, 30),
        imageHash: attachImage ? selection?.pictureHash : undefined,
      });
      setAnswer(result?.answer || "");
      setConversationId(result?.conversationId || "");
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleNewConversation() {
    setError("");
    setAnswer("");
    try {
      const session = await resetTutor();
      setConversationId(session?.conversationId || "");
    } catch (issue) {
      setError(issue.message);
    }
  }

  async function handleSave() {
    setError("");
    try {
      const title = selection?.noteTitle || normalizeExcerpt(selection?.excerpt).split("\n")[0] || "MarginNote 随手问";
      const note = await saveNote({ title: `MarginNote · ${title}`.slice(0, 200), body: answer });
      setSaved(note);
    } catch (issue) {
      setError(issue.message);
    }
  }

  return (
    <section className="page">
      <div className="row">
        <button type="button" className="ghost" onClick={readSelection}>
          读取当前选区
        </button>
        {selection?.noteTitle ? <span className="hint">{selection.noteTitle}</span> : null}
      </div>

      {!loggedIn ? (
        <p className="notice">
          还没登录懒学，<Link to="/settings">先去设置里登录</Link>。
        </p>
      ) : null}

      <div className="row">
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="ghost" onClick={() => fillPreset(preset)}>
            {preset.label}
          </button>
        ))}
      </div>

      <label className="radio">
        <input
          type="checkbox"
          checked={attachImage && Boolean(selection?.pictureHash)}
          disabled={!selection?.pictureHash}
          onChange={(event) => setAttachImage(event.target.checked)}
        />
        带上这张笔记里的手写/图片
        {selection?.pictureCount ? `（${selection.pictureCount} 张）` : "（这张笔记里没有）"}
      </label>

      <label className="field">
        <span>问助教（可以在同一段选区上接着追问）</span>
        <textarea value={prompt} rows={5} onChange={(event) => setPrompt(event.target.value)} />
      </label>

      <div className="row">
        <button type="button" onClick={handleAsk} disabled={busy || !prompt.trim()}>
          {busy ? "正在想…" : "问助教"}
        </button>
        <button type="button" className="ghost" onClick={handleNewConversation}>
          新会话
        </button>
        {conversationId ? <span className="hint">接着问还在这个会话里</span> : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {answer ? (
        <>
          <p className="stem answer">{answer}</p>
          <div className="row">
            <button type="button" className="ghost" onClick={handleSave}>
              存进懒学笔记
            </button>
            {saved?.url ? <span className="hint">已保存：{saved.title}</span> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
