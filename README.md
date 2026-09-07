# retniw

retniw 用来记录和整理自己的想法。可以先写一句，以后再接着写；想法多了，也能回头看看它们之间有没有联系。

[打开 retniw](https://retniw.cn)

## 怎么用

1. 打开就写，不用先分类，也不用先和 AI 对话。
2. 同一个想法可以接着写。暂时不想写了，可以点“先到这里”，以后再回来。
3. 记得某一句话时，在“以前的想法”中搜索原文，可以找回后续写下的段落和归档内容，并直接打开对应位置。
4. 想法多了以后，可以进入“回看”，开启并主动串联已有想法。retniw 会找出可能相关的旧想法，由你决定是否保留这条联系。

Enter换行，点击“保存”或按⌘/Ctrl+Enter保存。AI思考时仍可写草稿，结束后再保存。未提交的内容保留在当前浏览器，首页“本机草稿”可以继续打开。

以前的想法可以移入合集，也可以归档或删除。归档后不再出现在常用列表；删除后无法恢复，相关联系也会一起删除。

登录后，右上角显示当前邮箱。可以设置或清除昵称；昵称只在需要直接称呼时使用，不改变内容归属。

输入会先按账号保存在当前浏览器，再按写入顺序同步。页面发起读取、保存和导出时都会核对开始操作时的账号；若账号已在其他页面切换，会保留未同步内容并提示刷新。旧版本留下但无法确认所属账号的本机内容不会自动发送，需由当前用户确认归属后再恢复。

## AI

平时记录不会自动调用 AI。

- 点“帮我接着想”或“整理”时，AI 只读取当前想法里你写入或导入的内容。
- 设置昵称后，这些当前想法的 AI 请求会把昵称作为受限的称呼标签一并发送；标签不被当作身份、事实或指令。
- “回看”默认关闭。首次开启或之后点击“再串联一次”时，retniw 会把当前账号最多20条最近想法的开头和最新一段原文交给 DeepSeek，单次最多提出3条候选；开启后，新内容保存完成也会在后台寻找相关的旧想法。
- AI 生成的内容不会算作你的原文，也不会自动改写内容或保留联系。

使用这些功能时，相关文字会发送给 DeepSeek。不要写入工作机密或其他不应交给 Supabase、Vercel、DeepSeek 处理的信息。

## 导入和导出

- 可以粘贴文字，也可以导入 `.md`、`.txt` 文件。
- 可以复制单段、把当前想法导出为Markdown；联网时读取云端完整过程，再附上本机草稿和未同步段落，保留各自状态。
- 全部云端内容和已确认关系可以导出为JSON；本机尚未提交或同步的内容另提供JSON下载。断网时仍可带走已加载的本机快照。
- 同一账号可以在手机和桌面端使用；每个账号只能看到自己的内容。

## 使用数据

retniw 按账号记录四类使用行为：当天进入工作区、打开回看、完成一次主动串联，以及从联系打开原文。工作区和回看按上海自然日去重；主动串联只记录结果状态和候选数。

行为表使用固定字段，只保存事件、时间及必要的想法和联系标识；正文、AI 输入输出和账号资料不进入行为事件。账号、想法或联系被永久删除时，相应事件一起删除。

配置好服务端环境变量后，可以生成不含用户或内容标识的聚合快照：

```bash
npm run metrics:product
```

报告把用户输入与导入分开统计；24小时首次写入、跨日继续和同一想法追加使用用户输入口径。

## 技术栈

- Next.js 16、React 19、TypeScript
- Supabase Auth、Postgres
- DeepSeek
- Vercel

## 本地开发

需要 Node.js 20.9 或更高版本，以及一个已经创建 retniw 所需数据表的 Supabase 项目。

```bash
npm install
cp .env.example .env.local
```

在 `.env.local` 配置：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
```

`SUPABASE_SERVICE_ROLE_KEY` 和 `DEEPSEEK_API_KEY` 只能留在服务端环境，不能提交到仓库，也不能暴露给浏览器。

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

> 本仓库只包含增量数据库迁移，不能直接初始化空的 Supabase 项目。`supabase-schema.sql` 不适用于当前应用；数据结构与迁移说明见 [TECH-DESIGN.md](TECH-DESIGN.md) 和 `supabase/migrations`。

## 验证

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

## 项目文档

- [REQUIREMENT-ANALYSIS.md](REQUIREMENT-ANALYSIS.md)：为什么做
- [PRD.md](PRD.md)：当前功能和流程
- [TECH-DESIGN.md](TECH-DESIGN.md)：实现和数据结构

## 参与项目

发现问题或有建议，可以提交 [Issue](https://github.com/lazytsuki/retniw/issues)。如果是功能建议，请说一下你当时在做什么、哪里不好用。

## 许可证

本项目使用 MIT 许可证，见 [LICENSE](LICENSE)。可以个人或商业使用、修改和分发；保留版权和许可声明即可。软件按现状提供，不附带担保。
