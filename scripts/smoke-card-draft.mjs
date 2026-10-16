// 10 秒冒烟：node scripts/smoke-card-draft.mjs
import assert from "node:assert/strict";
import { draftCard, externalIdFor, normalizeExcerpt } from "../web/src/lib/cardDraft.mjs";

assert.equal(normalizeExcerpt("  第一行  \n\n 第二行 \n"), "第一行\n第二行");

assert.deepEqual(draftCard("死锁产生的四个必要条件\n互斥、请求与保持、不可剥夺、循环等待"), {
  front: "死锁产生的四个必要条件",
  back: "互斥、请求与保持、不可剥夺、循环等待",
});

assert.deepEqual(draftCard("缺页中断", "操作系统 · 第五章"), {
  front: "操作系统 · 第五章",
  back: "缺页中断",
});

assert.deepEqual(draftCard("   "), { front: "", back: "" });

const long = "长".repeat(5000);
assert.equal(draftCard(long).back.length, 4000);
assert.equal(draftCard(`标题\n${long}`).back.length, 4000);

assert.equal(externalIdFor({ noteId: "abc123" }), "marginnote:note:abc123");
const byContent = externalIdFor({ notebookId: "nb1", excerpt: "缺页中断" });
assert.equal(byContent, externalIdFor({ notebookId: "nb1", excerpt: "缺页中断 " }));
assert.notEqual(byContent, externalIdFor({ notebookId: "nb1", excerpt: "死锁" }));

console.log("✓ cardDraft smoke ok");
