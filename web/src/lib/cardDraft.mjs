// 摘录 → 问答卡草稿。纯函数：没有 DOM、没有桥，方便 scripts/smoke-card-draft.mjs 直接跑。
export const MAX_FRONT_CHARS = 200;
export const MAX_BACK_CHARS = 4000;

export function normalizeExcerpt(raw) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function clamp(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

export function draftCard(rawExcerpt, noteTitle = "") {
  const excerpt = normalizeExcerpt(rawExcerpt);
  if (!excerpt) return { front: "", back: "" };

  const lines = excerpt.split("\n");
  const firstLine = lines[0];
  const rest = lines.slice(1).join("\n").trim();
  const heading = normalizeExcerpt(noteTitle);

  return {
    front: clamp(heading || firstLine, MAX_FRONT_CHARS),
    back: clamp(rest || excerpt, MAX_BACK_CHARS),
  };
}

function djb2(input) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

// 同一张笔记反复发送要落在同一张卡上：优先用笔记 ID，没有笔记 ID 时用内容指纹。
export function externalIdFor(selection) {
  const noteId = String(selection?.noteId ?? "").trim();
  if (noteId) return `marginnote:note:${noteId}`;
  const fingerprint = `${String(selection?.notebookId ?? "").trim()}|${normalizeExcerpt(selection?.excerpt)}`;
  return `marginnote:excerpt:${djb2(fingerprint)}`;
}
