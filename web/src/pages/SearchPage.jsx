import { useCallback, useEffect, useState } from "react";
import { getSelection, searchQuestions } from "../lib/pluginApi";

function truncate(text, max = 160) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const fillFromSelection = useCallback(async () => {
    try {
      const picked = await getSelection();
      const excerpt = (picked?.excerpt || "").trim();
      if (!excerpt) {
        setError(picked?.reason || "先在 PDF 里选中一段文字");
        return;
      }
      setQuery(excerpt.split("\n")[0].slice(0, 60));
      setError("");
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  useEffect(() => {
    fillFromSelection();
  }, [fillFromSelection]);

  async function handleSearch() {
    if (!query.trim()) {
      setError("先填要搜的考点");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await searchQuestions(query.trim(), 10);
      setItems(result?.items || []);
      setSource(result?.source || "");
      setSearched(true);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <label className="field">
        <span>考点 / 题干关键词</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearch();
          }}
        />
      </label>

      <div className="row">
        <button type="button" onClick={handleSearch} disabled={busy}>
          {busy ? "正在搜…" : "搜懒学题库"}
        </button>
        <button type="button" className="ghost" onClick={fillFromSelection}>
          用当前选区
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {searched && !items.length && !error ? <p className="hint">没搜到相关题，换个说法再试。</p> : null}

      <ul className="results">
        {items.map((item) => (
          <li key={item.id}>
            <p className="stem">{truncate(item.stem, 220)}</p>
            <div className="row">
              {item.kind ? <span className="tag">{item.kind}</span> : null}
              {item.seq ? <span className="tag">第 {item.seq} 题</span> : null}
              {item.url ? <input className="link" readOnly value={item.url} /> : null}
            </div>
          </li>
        ))}
      </ul>

      {source ? <p className="hint">检索方式：{source === "text" ? "文字匹配" : "语义匹配"}</p> : null}
    </section>
  );
}
