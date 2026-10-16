# 懒学 LazyLearn · MarginNote 4 插件

两个方向：在 MarginNote 里读 PDF 时，把选中的摘录直接做成懒学闪卡、问助教、找题、把整本笔记本导成懒学笔记；反过来也能把懒学上的卡写回当前笔记本的脑图。

中文社区发布与反馈：[懒学 LazyLearn 插件发布帖](https://bbs.marginnote.com.cn/t/topic/68666)。首发文案保存在 [docs/community-post.md](docs/community-post.md)。

## 能力（第一期）

| 入口 | 做什么 | 依赖的懒学接口 |
| :--- | :--- | :--- |
| **摘录制卡** | 读当前选区 / 焦点笔记 → 生成问答卡草稿 → 改完存进懒学闪卡队列 | `POST /api/recite/cards` |
| **AI 出卡** | 选中一段材料让懒懒直接做成记忆卡（服务端制卡模式，做好的卡直接进队列，插件只摆回答原文） | `POST /api/conversations/{id}/messages`（`cardsRequest`） |
| **助教** | 三个常用动作（讲清楚这段 / 总结考点 / 出一道检验题）+ 接着追问，好用的回答一键存进懒学笔记；可以顺手把这张笔记里的手写/图片一起发过去 | `POST /api/conversations`、`POST /api/conversations/{id}/messages`（SSE）、`POST /api/media?scope=chat`、`POST /api/notes` |
| **考点找题** | 用选区或手输的关键词搜懒学题库，返回题干与题目链接 | `GET /api/search/questions` |
| **专题导入** | 把当前笔记本的脑图层级（标题 + 摘录 + 文字评论）导成懒学笔记：整本一篇，或每个根节点一篇；先预览再导 | `POST /api/notes` |
| **取回卡片**（反向） | 把懒学上的卡写进当前笔记本：正面当卡片标题、背面当一条评论，整批可 Cmd+Z 一次撤回；取过的卡不会重复取 | `GET /api/recite/cards` + `Database.createNoteWithTitleTopicid` |
| **设置** | 登录懒学账号、改接口地址 | `POST /api/auth/login`、`GET /api/auth/me` |

同一张 MarginNote 笔记重复发送会更新同一张卡：插件用 `noteId` 生成 `externalId`（没有笔记 ID 时退化成内容指纹），后端按「用户 + externalId」命中已有卡。反方向的去重记在插件自己的 `NSUserDefaults` 里（按笔记本分开），因为懒学那张卡有稳定 id。

## 下载

从 [Releases](https://github.com/Lazyeeeeeeee/lazylearn-marginnote-plugin/releases/latest) 下载 .mnaddon 文件，在 MarginNote 4 中打开安装，再登录懒学账号。

## 开发

构建打包使用 Node.js 24、npm 11 与 zip（macOS / Linux，或直接使用 GitHub Actions）。

```bash
npm install
npm run dev     # Vite 热更新 + 打包到 src/web-dist（真机连开发机时用）
npm run build      # 产出 lazylearn-marginnote-plugin-v1.0.6.mnaddon
npm run build:web  # 只打前端到 src/web-dist（CI 走这条，不依赖 zip）
npm run smoke      # 10 秒冒烟：原生网络封装 + 卡片草稿 + 桥命令表
npm run check      # 包装完整性 + 桥契约（require 的文件、网页调的命令、版本、前端产物）
```

`npm run build` 会先跑 `scripts/web-build.js` 把 `web/` 打成单文件 `src/web-dist/app.js`，再把 `src/` 压成 `.mnaddon`。

本仓库独立管理版本：package.json 与 src/mnaddon.json 的版本需一致。更新版本后推送 v* 标签，.github/workflows/ci.yml 会构建插件，并将 .mnaddon 安装包附到本仓库的 Release。

## 真机实测（macOS · MarginNote 4.4.6）

2026-10-15 在装好的 MN 4.4.6（macOS，容器 QReader.MarginStudy.easy）上跑过一轮，后端换成
本地 `127.0.0.1:8021` 的内存 API，不碰生产账号。跑通的：

1. **插件加载**：MN 重启后 `sceneWillConnect` 会执行（当时用一个写 `NSUserDefaults` 的探针量过，探针已删）。
2. **面板**：打开笔记本就会起，标题是「懒学 LazyLearn」，几个入口都能切。
3. **登录**：面板里填账号密码 → `POST /api/auth/login` → token 落进 `NSUserDefaults`（`lazylearn_token`）。
4. **取选区**：桥读得到 `notebookController.focusNote`（卡片标题「计算机系统概述」显示在面板上）；`selectionText` 这条在测试机上没验到内容——那台机器当时的 PDF 页是空白的，所以只确认了链路不报错、空选区有中文提示。
5. **制卡**：面板上写的卡真的进了懒学队列，`externalId` 是 `marginnote:note:<noteId>`。
6. **专题导入**：读到真实的笔记本结构（「计算机组成原理」1666 张笔记），分篇模式导了 50 篇进懒学笔记，API 里能看到「I/O方式」这种 4.5k 字的正文。
7. **取回卡片**（反向）：从懒学取回 2 张卡后，MN 卡片列表里真的多出「死锁产生的四个必要条件 / 互斥、请求与保持、不可剥夺、循环等待」与「缺页中断 / 要访问的页面不在内存，由操作系统装入」；再点一次显示「已取过 2 张」，不重复建卡。
8. **面板状态**：收起时的位置与开关落在 `lazylearn.marginnote_frame_config` / `lazylearn.marginnote_panel_on`。

还没验的：

- **iPad / iPadOS 版**：只在 macOS 上跑过。iPad 那边「设置 → 插件 → 允许加载未经认证的插件」是有的，行为应该一致但没实测。
- **在 PDF 里真选一段文字再制卡**：测试机当时没渲染出页面，`selectionText` 只验到链路。
- **助教 / AI 出卡的模型那一段**：本地 API 没配模型（服务端会回 403「普通会员无法使用平台模型」），要接真账号或配 Key 才能看回答。
- **带手写图问助教**：`PaintNote` → `getMediaByHash` → multipart 上传这条在 smoke 里用假数据验过，真机上没找到带手写评论的笔记。

### macOS 上怎么装（这版 MN 没给开关）

MN 4.4.6 的 macOS 版**设置里没有「插件」页**，插件面板也只有「导入」：导入未认证插件时只弹一句
「无法加载未经认证的插件」，没有「允许」按钮（iPad 版有）。`cert_key` 随便填个 uuid1 也不放行——
它校验的是 MN 从 CloudKit 拉的官方签名名单（二进制里 `isCertKeyValid:`、`com.marginnote.cloudkit.addoncert`）。

这台机器能跑起来，是因为直接把沙盒偏好里的开关写成了 true（MN 自己也认这个键）：

```bash
osascript -e 'tell application "MarginNote 4" to quit'   # 写偏好前必须先退，不然 cfprefsd 会覆盖
python3 - <<'PLIST'
import plistlib, pathlib
p = pathlib.Path.home() / "Library/Containers/QReader.MarginStudy.easy/Data/Library/Preferences/QReader.MarginStudy.easy.plist"
data = plistlib.loads(p.read_bytes())
data["mindbooks_allowuncertifiedext"] = True
p.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY))
PLIST
```

写的是 MN 自己容器里的偏好，所以要给终端／Codex 完全磁盘访问权限。开关打开后再走
「文件 → 插件 → 导入」，若弹「加载未经认证的插件可能会导致功能异常或数据丢失，是否确认允许？」选允许。
**要分发给别人还是得走官方签名**，这条只是本机自测的通路。

## 自动化

- `npm run smoke` 不需要真机：`scripts/smoke-network.mjs` 验证源码与压缩代码的网络全局导出及模拟原生登录；`scripts/smoke-card-draft.mjs` 跑纯函数，`scripts/smoke-bridge.mjs` 在 Node 的 `vm` 里塞假的原生对象（`Application` / `Database` / `NSUserDefaults` / `LazyLearnNetwork`）跑桥命令表。
- `npm run check` 是打包闸门：`main.js` 里 `JSB.require` 的文件必须在包里、网页面板 `call` 的桥命令必须在 `src/WebBridgeCommands.js` 的命令表里、`mnaddon.json` 与 `package.json` 版本一致、`web-dist` 的 JS/CSS 都在。这几样错了都是**装到 MarginNote 上才炸**，所以在本地与 CI 都拦一遍。
- CI 在本仓库的每次 main 推送、Pull Request 和 v* 标签推送时运行冒烟、完整构建与包装检查；版本标签通过检查后自动发布 .mnaddon 安装包。

## 已知边界

- 文字摘录与文字评论是默认路径；手写 / 图片走「带上笔记里的手写/图片」这一个开关，取的是笔记里**手写评论（`PaintNote`）**的媒体哈希 → `Database.getMediaByHash` → 上传。摘录图（`excerptPic`）那份字典官方文档没说清结构，没做。
- 一次只带第一张手写图（`pictureCount` 会告诉你有几张）；识别是服务端的事，要能跑模型（高级会员或自配 Key）。
- AI 出卡要能跑模型：高级会员用平台额度，普通会员得先在懒学网页端接入自己的模型 Key（否则服务端回 403，插件把这句原话摆出来）。一次出的张数由模型与提示词决定（插件问的是「最多 8 张」）；回答是一次性整段返回，中间没有进度。
- 助教的回答是**整段读回后一次显示**（对话接口虽然是 `text/event-stream`，但服务端是完整生成后一次性 yield，插件的 NSURLConnection 也是缓冲式），没有逐字流式；因此超时按 120 秒给。
- 复习进度以懒学为准，不写回 MarginNote。
- 专题导入是一份**单向快照**：只读一次、不自动同步、不动 MarginNote 里的内容；单篇超 10 万字、整次超 40 万字或根节点超 50 个会截断并标注；导的是文字，手写评论（`PaintNote`）与图片不进去（那一块走助教那个开关）。
- 摘录 → 问答卡目前是「首行当正面、其余当背面」的本地草稿规则，没有接模型生成。

## 仓库管理

主分支为 main；日常修改通过分支和 Pull Request 管理。每次推送和 PR 都会运行冒烟与构建检查。发布前同步插件元数据与 package.json 的版本，再推送同版本的 v* 标签。

公开源码不代表授予开源许可；当前保留原有 UNLICENSED 授权状态。
