import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createCard, getSelection, getSession, makeCards } from "../lib/pluginApi";
import { draftCard, externalIdFor, MAX_BACK_CHARS, MAX_FRONT_CHARS } from "../lib/cardDraft.mjs";
import { usePanelShow } from "../lib/usePanelShow";

const SUBJECTS = [
  { id: "", label: "按懒学当前学科" },
  { id: "cs408", label: "专业课 408" },
  { id: "math", label: "数学" },
  { id: "english", label: "英语" },
  { id: "politics", label: "政治" },
  { id: "other", label: "其他专业课" },
];

export default function CardPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [selection, setSelection] = useState(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsAnswer, setCardsAnswer] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);
  // 面板被重新打开时会再读一次选区。这时如果用户已经改过草稿，就别把他的字盖掉。
  const draftRef = useRef({ front: "", back: "" });
  const valuesRef = useRef({ front: "", back: "" });

  const applyDraft = useCallback((draft) => {
    draftRef.current = draft;
    valuesRef.current = draft;
    setFront(draft.front);
    setBack(draft.back);
  }, []);

  const editFront = useCallback((value) => {
    valuesRef.current = { ...valuesRef.current, front: value };
    setFront(value);
  }, []);

  const editBack = useCallback((value) => {
    valuesRef.current = { ...valuesRef.current, back: value };
    setBack(value);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const session = await getSession();
      setLoggedIn(Boolean(session?.loggedIn));
    } catch (issue) {
      setError(issue.message);
    }
  }, []);

  const readSelection = useCallback(
    async (options = {}) => {
      setError("");
      try {
        const picked = await getSelection();
        setSelection(picked);
        if (!picked?.available) {
          setError(picked?.reason || "读不到当前选区");
          return;
        }
        if (!picked.excerpt?.trim()) {
          setError("先在 PDF 里选中一段文字，或点中一张笔记");
          return;
        }
        const draft = draftCard(picked.excerpt, picked.noteTitle);
        const untouched =
          valuesRef.current.front === draftRef.current.front &&
          valuesRef.current.back === draftRef.current.back;
        if (!options.keepEdits || untouched) {
          applyDraft(draft);
          setSaved(null);
        }
      } catch (issue) {
        setError(issue.message);
      }
    },
    [applyDraft],
  );

  const handlePanelShow = useCallback(() => {
    refreshSession();
    readSelection({ keepEdits: true });
  }, [readSelection, refreshSession]);

  usePanelShow(handlePanelShow);

  useEffect(() => {
    refreshSession();
    readSelection();
  }, [readSelection, refreshSession]);

  // 服务端的制卡模式只认 math / cs408 / english / other；「其他专业课」与 408 才真出卡，
  // 数学与英语会落回讲题。没选学科就交给服务端按当前学科兜底。
  const knownSubject = ["math", "cs408", "english", "other"].includes(subject) ? subject : undefined;

  async function handleMakeCards() {
    const excerpt = selection?.excerpt?.trim();
    if (!excerpt) {
      setError("先在 PDF 里选中这段材料，再让懒懒出卡");
      return;
    }
    setCardsBusy(true);
    setError("");
    setCardsAnswer("");
    setSaved(null);
    try {
      const result = await makeCards({
        excerpt,
        noteTitle: selection?.noteTitle,
        subject: knownSubject,
        limit: 8,
      });
      setCardsAnswer(result?.answer || "");
    } catch (issue) {
      setError(issue.message);
    } finally {
      setCardsBusy(false);
    }
  }

  async function handleSave() {
    if (!front.trim() || !back.trim()) {
      setError("正面和背面都要写");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createCard({
        front,
        back,
        subject: subject || undefined,
        externalId: selection ? externalIdFor(selection) : undefined,
      });
      setSaved({ card: result?.card, url: result?.cardUrl });
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <div className="row">
        <button type="button" className="ghost" onClick={() => readSelection()}>
          读取当前选区
        </button>
        {selection?.noteTitle ? <span className="hint">{selection.noteTitle}</span> : null}
        {valuesRef.current.front !== draftRef.current.front ||
        valuesRef.current.back !== draftRef.current.back ? (
          <span className="hint">草稿已改，重新读选区不会覆盖</span>
        ) : null}
      </div>

      {!loggedIn ? (
        <p className="notice">
          还没登录懒学，<Link to="/settings">先去设置里登录</Link>。
        </p>
      ) : null}

      <label className="field">
        <span>摘录</span>
        <textarea className="excerpt" value={selection?.excerpt || ""} readOnly rows={4} />
      </label>

      <label className="field">
        <span>正面（问题 / 术语）</span>
        <textarea
          value={front}
          maxLength={MAX_FRONT_CHARS}
          rows={2}
          onChange={(event) => editFront(event.target.value)}
        />
      </label>

      <label className="field">
        <span>背面（要背的内容）</span>
        <textarea
          value={back}
          maxLength={MAX_BACK_CHARS}
          rows={5}
          onChange={(event) => editBack(event.target.value)}
        />
      </label>

      <label className="field">
        <span>学科</span>
        <select value={subject} onChange={(event) => setSubject(event.target.value)}>
          {SUBJECTS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <button type="button" onClick={handleSave} disabled={busy || !front.trim() || !back.trim()}>
          {busy ? "正在保存…" : "加入懒学复习"}
        </button>
        <span className="hint">重复发送同一张笔记会更新同一张卡</span>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <h2>让懒懒出卡</h2>
      <div className="row">
        <button
          type="button"
          className="ghost"
          onClick={handleMakeCards}
          disabled={cardsBusy || !selection?.excerpt?.trim()}
        >
          {cardsBusy ? "懒懒正在出卡…" : "按这段材料出卡（最多 8 张）"}
        </button>
        <span className="hint">走平台额度或你在懒学网页端配的 Key；408 / 其他专业课才会真出卡，数学与英语落回讲题</span>
      </div>
      {cardsAnswer ? (
        <>
          <pre className="answer preview">{cardsAnswer}</pre>
          <p className="hint">这些卡已经写进懒学闪卡队列，在「复习 → 背卡」里改或删。</p>
        </>
      ) : null}

      {saved?.card ? (
        <p className="ok">
          已加入懒学闪卡（{saved.card.front}）
          {saved.url ? (
            <>
              ，<a href={saved.url} target="_blank" rel="noreferrer">{saved.url}</a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
