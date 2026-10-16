import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSession, importNotebook, previewNotebook } from "../lib/pluginApi";
import { usePanelShow } from "../lib/usePanelShow";

export default function NotebookPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [mode, setMode] = useState("single");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await previewNotebook(mode);
      setPreview(result);
      if (result && !result.available) {
        setError(result.reason || "读不到当前笔记本");
      }
    } catch (issue) {
      setError(issue.message);
    }
  }, [mode]);

  usePanelShow(load);

  useEffect(() => {
    getSession()
      .then((session) => setLoggedIn(Boolean(session?.loggedIn)))
      .catch((issue) => setError(issue.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleImport() {
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const result = await importNotebook({ mode });
      setDone(result);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <p className="hint">
        把当前 MarginNote 笔记本的脑图层级（标题 + 摘录 + 文字评论）导成懒学笔记，之后能在知识库里检索、讲解、制卡：
        整本一篇适合回顾整章，根节点各一篇更像一章一节地复习。
      </p>

      <div className="row">
        <button type="button" className="ghost" onClick={load}>
          重新读一次
        </button>
        {preview?.available ? (
          <span className="hint">
            {preview.title} · {preview.noteCount} 张笔记 · 会写成 {preview.documentCount} 篇
            {preview.truncated ? "（超长，会截断）" : ""}
          </span>
        ) : null}
      </div>

      <div className="row">
        <label className="radio">
          <input
            type="radio"
            name="notebook-mode"
            checked={mode === "single"}
            onChange={() => setMode("single")}
          />
          整本一篇
        </label>
        <label className="radio">
          <input
            type="radio"
            name="notebook-mode"
            checked={mode === "roots"}
            onChange={() => setMode("roots")}
          />
          每个根节点一篇（章节分开）
        </label>
      </div>

      {preview?.titles?.length ? (
        <p className="hint">
          会写这些篇：{preview.titles.join("、")}
          {preview.documentCount > preview.titles.length ? " …" : ""}
        </p>
      ) : null}

      {!loggedIn ? (
        <p className="notice">
          还没登录懒学，<Link to="/settings">先去设置里登录</Link>。
        </p>
      ) : null}

      {preview?.preview ? (
        <>
          <pre className="answer preview">{preview.preview}</pre>
          <div className="row">
            <button type="button" onClick={handleImport} disabled={busy || !preview.available}>
              {busy ? "正在导入…" : "导入为懒学笔记"}
            </button>
            <span className="hint">只读一份快照进来，不动 MarginNote 里的内容</span>
          </div>
        </>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {done ? (
        <p className="ok">
          已导入 {done.count} 篇 / {done.noteCount} 张笔记{done.truncated ? "（超长已截断）" : ""}：{" "}
          {done.titles.join("、")} → {done.url}
        </p>
      ) : null}
    </section>
  );
}
