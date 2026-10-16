import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSession, previewPullCards, pullCards } from "../lib/pluginApi";
import { usePanelShow } from "../lib/usePanelShow";

const SCOPES = [
  { id: "deck", label: "复习队列（今天要复习的）" },
  { id: "mine", label: "我建的卡" },
  { id: "all", label: "全部（含队列里的官方卡）" },
];
const LIMITS = [10, 20, 50];

export default function PullPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [scope, setScope] = useState("deck");
  const [limit, setLimit] = useState(20);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await previewPullCards({ scope, limit });
      setPreview(result);
      if (result && !result.available) setError(result.reason || "读不到当前笔记本");
    } catch (issue) {
      setError(issue.message);
    }
  }, [scope, limit]);

  usePanelShow(load);

  useEffect(() => {
    getSession()
      .then((session) => setLoggedIn(Boolean(session?.loggedIn)))
      .catch((issue) => setError(issue.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePull() {
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const result = await pullCards({ scope, limit });
      setDone(result);
      await load();
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <p className="hint">
        把懒学上的卡写进当前笔记本：正面当卡片标题、背面当一条评论，整批可以 Cmd+Z 一次撤回。取回过的卡不会再取一遍。
      </p>

      {!loggedIn ? (
        <p className="notice">
          还没登录懒学，<Link to="/settings">先去设置里登录</Link>。
        </p>
      ) : null}

      <div className="row">
        {SCOPES.map((item) => (
          <label className="radio" key={item.id}>
            <input
              type="radio"
              name="pull-scope"
              checked={scope === item.id}
              onChange={() => setScope(item.id)}
            />
            {item.label}
          </label>
        ))}
      </div>

      <label className="field">
        <span>一次最多取几张</span>
        <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
          {LIMITS.map((value) => (
            <option key={value} value={value}>
              {value} 张
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <button type="button" onClick={handlePull} disabled={busy || !preview?.available || !preview?.pending}>
          {busy ? "正在写进脑图…" : "取回到当前笔记本"}
        </button>
        <button type="button" className="ghost" onClick={load}>
          重新看一下
        </button>
        {preview?.available ? (
          <span className="hint">
            懒学上有 {preview.total} 张，这张笔记本还差 {preview.pending} 张
            {preview.skipped ? `（已取过 ${preview.skipped} 张）` : ""}
          </span>
        ) : null}
      </div>

      {preview?.titles?.length ? (
        <ul className="results">
          {preview.titles.map((title, index) => (
            <li key={`${title}-${index}`}>
              <p className="stem">{title}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {done ? (
        <p className="ok">
          已写进脑图 {done.created} 张{done.skipped ? `，跳过已取过的 ${done.skipped} 张` : ""}
          {done.failed ? `，失败 ${done.failed} 张` : ""}。
        </p>
      ) : null}
    </section>
  );
}
