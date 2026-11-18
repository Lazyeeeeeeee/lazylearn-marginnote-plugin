import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getPreferences,
  getSelection,
  getSession,
  practiceGroup,
  searchQuestions,
} from "../lib/pluginApi";

const SUBJECTS = [
  { id: "cs408", label: "专业课 408" },
  { id: "math", label: "数学" },
  { id: "english", label: "英语" },
  { id: "politics", label: "政治" },
  { id: "other", label: "其他专业课" },
];

const KIND_LABELS = {
  single_choice: "单选",
  multiple_choice: "多选",
  fill_blank: "填空",
  solve: "解答",
};

function truncate(text, max = 160) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || String(kind || "");
}

function subjectLabel(id) {
  const found = SUBJECTS.find((item) => item.id === id);
  return found ? found.label : String(id || "");
}

function QuestionList({ items }) {
  return (
    <ul className="results">
      {items.map((item) => (
        <li key={item.id}>
          <p className="stem">{truncate(item.stem, 220)}</p>
          <div className="row">
            {item.kind ? <span className="tag">{kindLabel(item.kind)}</span> : null}
            {item.seq ? <span className="tag">第 {item.seq} 题</span> : null}
            {item.optionCount ? <span className="tag">{item.optionCount} 个选项</span> : null}
            {item.url ? <input className="link" readOnly value={item.url} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const [loggedIn, setLoggedIn] = useState(false);
  const [subject, setSubject] = useState("cs408");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [group, setGroup] = useState(null);

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

  const refreshAccount = useCallback(async () => {
    try {
      const session = await getSession();
      const on = Boolean(session?.loggedIn);
      setLoggedIn(on);
      if (!on) return;
      try {
        const loaded = await getPreferences();
        const enabled = (loaded?.enabledSubjects || []).filter((id) =>
          SUBJECTS.some((item) => item.id === id),
        );
        setSubject((current) => {
          if (!enabled.length) return current;
          return enabled.includes(current) ? current : enabled[0];
        });
      } catch (issue) {
        // 偏好读不到不挡换题：按整科和默认卷别继续。
      }
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  useEffect(() => {
    fillFromSelection();
    refreshAccount();
  }, [fillFromSelection, refreshAccount]);

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

  async function handleGroup() {
    if (!loggedIn) {
      setGroupError("先登录懒学账号");
      return;
    }
    setGroupBusy(true);
    setGroupError("");
    setGroup(null);
    try {
      const result = await practiceGroup({
        subject,
        limit: subject === "english" ? 1 : 6,
      });
      setGroup(result || null);
    } catch (issue) {
      setGroupError(issue.message);
    } finally {
      setGroupBusy(false);
    }
  }

  const groupItems = group?.items || [];
  const groupHints = [];
  if (group?.weakTopics) groupHints.push(`账号里有 ${group.weakTopics} 个薄弱点`);
  if (group?.weakChapters) groupHints.push(`匹配到 ${group.weakChapters} 个章节`);
  if (group?.fallback) groupHints.push("这几章暂时没题，已退回整科");

  return (
    <section className="page">
      <h2>按薄弱点换题</h2>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>学科</span>
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            {SUBJECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={handleGroup} disabled={groupBusy || !loggedIn}>
          {groupBusy
            ? "正在选题…"
            : subject === "english"
              ? "换 1 篇阅读"
              : "换 6 题"}
        </button>
      </div>
      <p className="hint">
        按这科的练习历史挑一组没怎么练过的题；账号里填了薄弱点时，只从匹配到的章节抽。
      </p>

      {!loggedIn ? (
        <p className="notice">
          还没登录懒学，<Link to="/settings">先去设置里登录</Link>。
        </p>
      ) : null}
      {groupError ? <p className="error">{groupError}</p> : null}

      {group ? (
        <p className="ok">
          已按「{subjectLabel(group.subject)}」取到 {groupItems.length} 道题
          {groupHints.length ? `（${groupHints.join("；")}）` : ""}。
        </p>
      ) : null}
      {group && groupItems.length ? (
        <>
          <QuestionList items={groupItems} />
          <p className="hint">
            去懒学练题页作答：
            <a href={group.url} target="_blank" rel="noreferrer">
              {group.url}
            </a>
          </p>
        </>
      ) : null}
      {group && !groupItems.length ? (
        <p className="hint">这科暂时没有可练的题，换个学科或去懒学题库看看。</p>
      ) : null}

      <h2>考点找题</h2>
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

      <QuestionList items={items} />

      {source ? <p className="hint">检索方式：{source === "text" ? "文字匹配" : "语义匹配"}</p> : null}
    </section>
  );
}
