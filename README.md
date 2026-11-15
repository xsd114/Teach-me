# Teach me

**一个会教你的私人图书馆。** 丢进来一门课，它先摸清你的底子，写一本只给你的教材，然后一节一节带你读。

本地优先 · 数据在自己硬盘上 · 教材和讲解都按你的水平现场生成

---

## 为什么做这个

现有的学习工具分成两类：

- **网课 / 教材**：内容固定，跟不上你的人。太浅的你已经会了，太深的你卡住了
- **AI 聊天**：什么都能聊，但它不知道你学到哪、哪卡过、你手上有什么书

Teach me 想补中间那块：**它记住你**。你划的重点、问的问题、做错的题，都会变成它的记忆，影响下一节课怎么讲。

---

## 它是什么

| | |
|---|---|
| **建课** | 问你五个问题（底子、目标、偏好、每天能学多久、想要什么风格），问完才动笔 |
| **写教材** | 每节不少于 3000 字，从定义讲起，配可交互的图 |
| **上课** | 拆成一步步，讲完一步停下来等你。听懂就下一步，没懂就换更小的例子 |
| **划重点** | 选完文字长按右键，弹三色圆盘，滑到哪个松手就是哪个色 |
| **记忆库** | 资料切块 + 向量化。你的重点标记能一键归纳进库，以后讲课照着走 |
| **自习** | 打字或说话提问。它手上就是你的书，会指到具体哪一段回答 |
| **提示词开放** | 写教材、出题、讲课、答疑的提示词全在设置里摊开，能改 |

---

## 快速开始

### 用安装包（推荐）

1. 从 Releases 下载 `Teach-me-1.0.0-setup.exe`（或绿色版 `Teach-me-1.0.0-x64.zip`）
2. 双击安装，桌面会有快捷方式
3. 第一次打开会弹八页介绍，看完就知道怎么用了

> Windows 会提示「未知发布者」——因为没买代码签名证书。点「更多信息 → 仍要运行」即可。

### 从源码跑

```bash
git clone https://github.com/<your-name>/teach-me.git
cd teach-me
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5273

**环境要求**

- Node.js >= 22（用到 `node:sqlite`）
- pnpm >= 9
- Python 3.10+（解析 PDF/PPT 用，可选但强烈建议）

```bash
pip install markitdown
```

### 打包成 exe

```bash
pnpm run build:electron   # 编译前后端
pnpm run dist             # 出安装包，产物在 release/
```

---

## 配置

第一次打开后去 **设置**：

| 项 | 说明 |
|---|---|
| **模型** | 填 API Key。DeepSeek / 火山方舟 / 本地 Ollama 都行，只要兼容 OpenAI 格式 |
| **语音** | MOSS 的 Key。不填就是静音——不会退回系统那种机器音 |
| **划词标记** | 用哪个键长按、长按多久、圆盘上放哪几个颜色 |

> API Key 只存在本机数据库里，**绝不写进代码或提交到仓库**。

---

## 数据在哪

```
E:/Teach me-data/            E 盘存在时优先
%APPDATA%/Teach me/          找不到 E 盘时
```

里面是数据库（SQLite）、上传的文件、模型缓存。设置 → 数据里能看到具体路径，也能一键备份。

---

## 技术栈

```
后端    Node 24 · Fastify 5 · node:sqlite
前端    React 19 · Vite 8 · Tailwind 4 · framer-motion · Recharts
检索    sqlite-vec (vec0) + FTS5 trigram + RRF 融合
向量    transformers.js + bge-small-zh-v1.5（本地跑，512 维）
解析    markitdown（PDF / Word / PPT / Markdown）
桌面    Electron 45 · electron-builder
语音    浏览器 SpeechRecognition（识别）+ MOSS TTS（朗读）
```

---

## 站在谁的肩膀上

这个项目能跑起来，是因为下面这些。

### 核心依赖

- [Fastify](https://github.com/fastify/fastify) — 后端框架
- [React](https://github.com/facebook/react) · [Vite](https://github.com/vitejs/vite) — 前端
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) — 样式
- [framer-motion](https://github.com/framer/motion) — 动效（圆盘、卡片闪烁、彩虹呼吸灯都是它）
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — SQLite 上的向量检索，作者 Alex Garcia
- [transformers.js](https://github.com/huggingface/transformers.js) — 在 Node 里跑 transformer
- [markitdown](https://github.com/microsoft/markitdown) — 微软的文档转 Markdown
- [Electron](https://github.com/electron/electron) · [electron-builder](https://github.com/electron-userland/electron-builder) — 桌面打包

### 模型

- [bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) — 北京智源研究院（BAAI）的中文向量模型
- [DeepSeek](https://www.deepseek.com/) — 生成教材、讲课、答疑
- [MOSS](https://platform.moss.cn/) — 语音合成

### 教学法与提示词

教材那七块结构不是拍脑袋想的：

**[Mr.-Ranedeer-AI-Tutor](https://github.com/JushBJJ/Mr.-Ranedeer-AI-Tutor)（29.5k stars）**

- 借鉴：`Do not compress your responses`（不要压缩回答）这条硬规则
- 借鉴：课程分 0.x（前置）/ 1.x（主体）两层
- 借鉴：学生配置多维度（深度 / 学习风格 / 沟通风格 / 语气 / 推理框架）

**[education-agent-skills](https://github.com/GarethManning/education-agent-skills)（981 stars）**

- 借鉴：**I Do / We Do / You Do** 渐进释放责任模型
- 依据：Rosenshine (2012) 十项教学原则、Pearson & Gallagher (1983)、Hattie (2009) 直接教学效应量 0.59
- 那句点醒我的话：「有效直接教学要求老师把不可见的专家思维变成可见的，把一个自己自动完成的技能拆成离散的、可教的步骤，并把推理说出来」

教材每一节因此是这个顺序：

```
【定义】 -> 【为什么要有它】 -> 【怎么来的】(I Do) -> 【跟着走一遍】(We Do)
        -> 【你自己试】(You Do) -> 【两个坑】 -> 【条件不够怎么办】
```

每一块都有字数配额（定义 400-600 字 / I Do 600-800 字 / ...）。这是让模型真写到 3000 字的关键——只写「不少于 3000 字」，它会砍结构。

### 文档差异对比

- [jagadeeshtroyer/smart-pdf-difference-compare](https://github.com/jagadeeshtroyer/smart-pdf-difference-compare)
- [iamwatchdogs/Policy-Diff-Assistant](https://github.com/iamwatchdogs/Policy-Diff-Assistant)
- [CSOAI-ORG/document-comparison-ai-mcp](https://github.com/CSOAI-ORG/document-comparison-ai-mcp)

借鉴它们的**结构层 + 文本层 + 语义层**三层对比思路，但去掉了逐字 diff——两本书排版不同会满屏飘红，用户看不出重点。只保留：

- 标题相似度（Dice 系数 + 最长公共子串双判定）
- 篇幅差异（同一章字数差 > 30% 标黄）

---

## 项目结构

```
apps/
  server/           Fastify 后端
    src/db/         schema + 迁移（现在是 v10）
    src/prompts/    七条提示词，默认值编译进程序
    src/services/   教材 / 讲课 / 自习 / 向量 / MOSS
    src/routes/     API
  web/              React 前端
    src/pages/      书架 / 课程 / 教材 / 上课 / 自习 / 设置
    src/components/ 划词菜单 / 三色圆盘 / 标记栏 / 欢迎框
electron/           主进程 + 打包配置
```

---

## 已知不足

写在这里，因为我知道它们在哪。

### 自习模式还不够智能

现在是**半双工**：你说完 → 它想 → 它说 → 你再说。中间有停顿。

想要的是**全双工**：随时插话、它也能随时被打断。难点不在语音通道（MOSS 的 `moss-live-1.0` 本来就支持），在于**结合记忆库**：

- 全双工要求延迟压到几百毫秒
- 但每次回答都要检索教材 + 向量库，光检索就得几百毫秒
- 一边检索一边说话，就会说到一半发现「刚才那句不对」

现在的折中是把检索结果整段拉出来再开口——所以它必须等你想完才能答。

### 上课模式没办法让人集中注意力

它讲得挺细，但**它不会管你在不在看**。

现实是：讲三分钟人就走神了。缺的是：

- 讲到一半突然抛问题（不是「听懂了吗」，是「那你说这个下一步该算什么」）
- 检测到长时间没动静就停下来
- 每隔几段强制插入一次动手环节

现在只是把教材拆成了「步骤」，本质上还是**单向输出**。

### 其他

- 教材和课时仍是两套东西，没真正打通
- 划词跨段落（比如跨过 `<strong>`）的高亮会跳过，只标到能匹配的单节点片段
- 配图只能在章标题下面，插不进正文中间
- 单章重写会跑一遍整章，慢
- 图标还是 Electron 默认的
- 没有代码签名，Windows 会拦一下

---

## 接下来

- [ ] **安卓端** —— 手机上也能上课。重点是把「划重点」的手势重做（长按圆盘在触屏上得换一套）
- [ ] **双端同步** —— 电脑上标的重点，手机上打开就在。倾向本地优先 + 可选自建同步服务器，不上云
- [ ] **多种颜色主题和背景** —— 现在只有深色一套。想加：护眼米色、纯白、夜间橙
- [ ] **操作上的改进** —— 键盘快捷键、批量操作、拖拽排序
- [ ] 自习模式向全双工推进（先把检索做成流式）
- [ ] 上课中途的注意力检测

---

## 许可

[MIT](LICENSE)

用、改、商用都行，出了事别找我。