# retniw 技术设计

## 决策摘要

### 核心组件

| 位置 | 职责 | 当前行为 |
| --- | --- | --- |
| [`ThoughtNavigation`](src/components/thoughts/thought-navigation.tsx#ThoughtNavigation) | 工作区导航 | 最近内容为历史根；合集、归档、回看为次级入口；不提供已删除视图 |
| `ThoughtSearch`、`GET /api/thoughts/search` | 全文找回 | 本人user/import原文连续文字检索，包含归档与后续段落；匹配摘要链接到精确entry锚点 |
| `AppHeader`、`app/auth/created`、`app/account/actions.ts` | 账号入口 | 创建成功先进入轻量过渡页；顶栏回显邮箱并编辑昵称 |
| [`ThoughtComposer`](src/components/thoughts/thought-composer.tsx#ThoughtComposer) | 内容输入 | Enter换行，⌘/Ctrl+Enter或显式按钮保存；输入随内容增长，AI运行只暂停提交，草稿继续可写 |
| `thought_outbox`、[`useCaptureOutbox`](src/hooks/use-capture-outbox.ts#useCaptureOutbox) | 本机保存 | 按`userId`隔离草稿和待同步内容；同一想法按创建顺序发送，旧版无归属记录需由当前用户确认后恢复 |
| `x-retniw-expected-user-id`、`expectedUserId`、[`requireRequestUser`](src/lib/auth/require-user.ts#requireRequestUser) | 页面账号围栏 | 客户端读取和写入携带页面账号；云端导出先预检，再通过同源查询参数下载。当前快照导出校验页面owner，网络不可用时仅下载已加载的当前账号内容；明确认证失败或账号变化时阻断 |
| [`ThoughtListItem`](src/components/thoughts/thought-list-item.tsx#ThoughtListItem)、[`ThoughtActionMenu`](src/components/thoughts/thought-action-menu.tsx#ThoughtActionMenu) | 内容管理 | 删除经强确认后调用 HTTP DELETE，不提供恢复 |
| `app/review`、`ReviewWorkspace` | 跨想法回看 | 承接主动串联、开启说明、联系候选和已保留联系，不提供聊天输入 |
| `POST /api/review/scan`、`ReviewService.scanExistingThoughts` | 主动串联 | 扫描最多20条既有想法，候选复用唯一关系真相源 |
| [`POST /api/thoughts`](app/api/thoughts/route.ts#POST)、追加内容POST路由 | 内容保存 | 用户原文同步成功后用 Next `after()`安排有界回看，不延长保存响应 |
| [`ThoughtConnectionRepository`](src/server/repositories/thought-connection-repository.ts#ThoughtConnectionRepository) | 联系状态 | `pending / confirmed / rejected`表示候选、保留、忽略，并提供全局批量读取 |
| `user_review_preferences` | 隐私偏好 | 用户级回看开关默认关闭，跨设备同步，账号删除时级联清理 |
| `entries.review_checked_at`、[`EntryRepository.claimForReview`](src/server/repositories/entry-repository.ts#claimForReview) | 回看认领 | 每条user/import entry独立原子认领；重复回调只处理一次，乱序回调互不覆盖 |
| [`ThoughtConnectionRepository.listForReview`](src/server/repositories/thought-connection-repository.ts#listForReview)、[`countForReview`](src/server/repositories/thought-connection-repository.ts#countForReview) | 联系读取 | 四个精确外键内连接先过滤可见关系，再分页、计数并直接序列化 |
| `product_events`、`POST /api/product-events` | 使用行为 | 固定记录工作区、回看、主动串联结果和联系原文打开事件；事件失败不阻断产品动作 |
| [`scripts/report-product-metrics.mjs`](scripts/report-product-metrics.mjs) | 聚合指标 | 用户输入与导入分开统计，输出24小时首次用户输入、跨日继续、AI保存结果、回看和联系使用情况，不输出用户或内容标识 |
| [`ThoughtRepository`](src/server/repositories/thought-repository.ts#ThoughtRepository)、`deleted_thought_tombstones`、[`ThoughtExportRepository`](src/server/repositories/thought-export-repository.ts#ThoughtExportRepository) | 生命周期与导出 | 正文及关联数据物理删除；仅保留账号与想法ID组成的删除墓碑，历史软删除行保持隐藏 |

- 产品状态只分三层：用户原文是记录，AI产出的是联系候选，用户保留后才进入回看中的长期联系；不使用图数据库或回看快照表。
- 当前想法中的“帮我接着想”和“整理”只在用户主动调用时使用当前想法；后台能力只负责跨想法比较，不生成正文、不续写、不分类。
- 昵称保存在 Supabase Auth `user_metadata.nickname`中，是受限称呼标签，不进入关系匹配，也不能被当作提示词指令。
- 本机outbox、客户端请求和账号Action使用同一页面账号快照。跨标签切换账号后，旧页面不再读取或写入新账号；未同步正文保留在原账号本机队列，刷新后按当前账号重新建立页面状态。
- 共享`OverlayProvider`在路径切换时关闭当前浮层，避免菜单状态跨想法或跨退出、重新登录的流程残留。
- 回看默认关闭。后台任务先读取用户级开关，只有已开启才读取并发送必要的新旧用户原文；关闭后新保存不再触发比较。
- `thought_connections`是唯一关系真相源；同一对想法沿用规范化顺序和唯一约束。`pending / confirmed`持续阻止重复候选；`rejected`在两端没有新增user/import entry时阻止重复候选，有新内容后可以复用原记录重新进入`pending`。
- 归档是“以前的想法”的子视图，仍可参与跨想法比较；`deleted_at is not null`的历史行在所有产品读取中排除且不自动清理。
- 新删除由`DELETE /api/thoughts/:id`调用数据库事务函数物理执行，只命中`deleted_at is null`且属于当前用户的行；同一事务先写入不含正文的删除墓碑，阻止结果不明的旧创建请求复活该ID。`PATCH`不再承担删除或恢复。
- 保存后的回看使用 Next.js 16 `after()`；Vercel通过`waitUntil`延长函数生命周期，回调受路由`maxDuration`限制，因此失败只能降级为本次不产出候选，不能反向改变保存结果。每个user/import entry用自己的`review_checked_at`独立原子认领：同一entry重试只处理一次，不同entry即使回调乱序也各自处理。
- 数据库方言为`postgresql`；用户回看偏好保存在独立表中，entry使用可空认领列记录回看处理状态。

### 保存后回看流程

```mermaid
flowchart TD
    A[用户原文或导入内容写入成功] --> B[立即返回保存结果]
    B --> C[after 后台回调]
    C --> D{回看已开启}
    D -->|否| E[结束，不读取旧内容]
    D -->|是| F{原子认领当前entry}
    F -->|已处理或AI entry| E
    F -->|认领成功| G[读取当前新原文和最多20条历史摘要]
    G --> H[排除删除内容和已有关系对]
    H --> I[DeepSeek返回0至3个有锚点候选]
    I --> J[幂等写入 pending 联系]
    J --> K[/review 展示]
    K -->|保留| L[confirmed]
    K -->|忽略| M[rejected]
```

## 实现设计

### 前端

#### 写作、找回与内容带走

- `src/index.css`统一页面、输入、悬停与分隔线令牌，正文最大720像素。入口使用系统衬线标题，正文和控件保持系统无衬线；减弱卡片阴影，当前用户原文的可读性优先。移动端保留抽屉，减少动态效果设置继续生效。
- 本机草稿仍以账号下的outbox为唯一来源。`LocalDrafts`在首页展示可恢复内容；恢复前等待当前输入落盘，异步初始化不能覆盖用户已经开始的输入。页面工作区key包含账号，账号刷新后重新建立状态。
- 搜索通过`entries_thought_owner_fk!inner`连接想法，双侧按user_id过滤，排除deleted_at及AI条目。用转义后的`imatch`实现字面连续子串、忽略大小写，避免PostgREST把星号当通配符。每次取20+1条，游标绑定关键词及created_at/id；响应只包含有限命中片段，不将全量原文发送给客户端。无需数据库迁移。
- `ThoughtSearch`使用250毫秒防抖、AbortController和请求序号，清空或切换查询后旧结果不能覆盖新状态；桌面和移动导航复用同一组件。
- 当前想法在线导出复用服务端分页读取的完整Markdown流，读取完成后附加当前账号本机内容；同时保留点击时与读取后仍在本机的段落，防止同步过程中移除导致漏字。附录保留稳定ID，说明刚同步的同ID内容可能也出现在云端正文中。断流不作为完整导出，离线快照按entryId合并页面原文、本机段落与停靠点，并在文件名和内容中标记范围。流式AI未落库部分不作为已保存内容。全部云端JSON保持服务端原生下载，本机JSON独立导出。
- `verifyExportOwner`在网络可用时核验服务端账号；明确401/403/409不能降级。断网或网络超时仅允许当前页面owner一致的本机快照，并标明offline；不读取其他账号或其他设备内容。

#### 账号创建与身份回显

- 需求/验收：创建账号后不需要刷新；顶栏能识别当前账号并编辑昵称。
- 实现：`signup`建立会话后进入只依赖认证的`/auth/created`，500毫秒后用整页请求进入`/`，并保留手动入口。`ThoughtRepository.listRecent`遇到错误时重建完全相同的查询，120毫秒后只重试一次；第二次失败只记录错误码和状态码。
- 实现：`requireUser`从已验证的会话claims读取邮箱和昵称。昵称最多24个Unicode码点，拒绝不可见控制字符；服务端Action执行`updateUser → refreshSession → revalidatePath`。`DeepSeekTextProvider`只把合法昵称注入当前想法和澄清提示词，同时声明它不是身份、事实或指令。
- 相关符号：`app/login/actions.ts`、`app/auth/created`、`AppHeader`、`updateNickname`、`requireUser`、`DeepSeekTextProvider`、`ThoughtRepository.listRecent`
- 边界与不变约束：邮箱是账号回显，不在这个面板更改；昵称留空即清除；建立会话失败不进入过渡页；业务查询失败不降级为空数据。

#### 桌面侧栏与移动抽屉

- 需求/验收：收起侧栏后不保留随视口增长的空白；归档和回看不随列表滚出底部；桌面和移动端使用同一导航数据。
- 实现：901像素以上的`.app-shell`铺满宽度；桌面主区使用同构五轨网格，收起轨道宽52像素，与主区间距16像素，通过同一缓动连续插值侧栏、间距和主区留白，不在动画途中切换对齐方式。900像素以下保留最大732像素的居中内容和抽屉导航；系统启用减少动态效果时立即完成切换。
- 相关符号：`.app-shell`、`.app-header--sidebar-collapsed`、`.thought-layout--sidebar-collapsed`、`ThoughtNavigation`
- 边界与不变约束：不在移动端渲染收起轨道；安全区内边距在两种布局中都保留。

#### 历史根与归档子视图

- 需求/验收：进入归档后不出现“全部”或“已删除”标签；取消归档后回到最近内容，合集归属不变。
- 实现目标：`retniw-web`，历史根、合集和归档保持清楚的父子层级。
- 实现：视图类型为`recent | archived | collection`。根视图先显示最近想法，再显示合集，末尾提供“归档”和“回看”次级入口；归档视图顶部使用返回按钮与标题“归档”，空态为“还没有归档的想法。”。移动历史面板与桌面侧栏复用同一内容结构。
- 相关符号：`ThoughtNavigation`、`navigationContent`、`View`、`GET /api/thoughts`
- 验证入口：桌面侧栏与移动历史面板分别进入和退出归档；验证无同级筛选、无删除区、归档空态、取消归档后合集ID未变化。
- 边界与不变约束：合集仍为单层；归档只改变`archived_at`，不改变原文、合集、停靠点或关系。

#### 永久删除交互

- 需求/验收：所有删除入口都先强提醒，确认后无法恢复，想法、内容和相关联系不可再读取。
- 实现目标：`retniw-web`，统一桌面更多/右键和移动左滑/长按的危险操作语义。
- 实现：不提供`deleted`模式、恢复图标或恢复动作。所有删除入口只打开同一个模态框，标题“删除这个想法？”，正文“删除后无法恢复，相关联系也会一并删除。”，按钮“取消 / 删除”。确认按钮提交期间禁用；收到204或重复删除的404后，按当前账号记录本机删除墓碑并清理该想法的待同步内容，再从界面移除；失败则恢复条目并保留结果未确认提示。
- 相关符号：`ThoughtActionMenu`、`ThoughtListItem`、`ThoughtNavigation.performAction`、删除确认`dialog`
- 验证入口：更多、右键、左滑、长按分别触发；取消不发请求；重复点击只发一次DELETE；成功后前进、后退、直接访问原链接均无法读取。
- 边界与不变约束：手势只揭示“删除”，不能绕过确认；删除合集仍是另一条只解除归属的契约。

#### 独立回看页面

- 需求/验收：首次开启前说明处理范围；候选可回到两端原文，保留的联系可再次打开；页面不被理解为聊天。
- 实现目标：`retniw-web`使用动态路由`/review`和`ReviewWorkspace`，并复用应用顶栏、历史导航、SVG线条与颜色变量。
- 实现：跨想法能力只从导航进入`/review`，不与当前想法AI并列，避免重复入口。`/review`主区先提供主动串联入口，再按“等你判断 / 已保留”两层展示；每张候选按锚点时间并列显示最多1000字的“后来写的 / 更早写的”原文摘录、简短依据和“保留 / 忽略”。两端均链接`/thoughts/:id#entry-:entryId`；打开后目标entry获得焦点与克制高亮。没有候选时只显示事实空态，不生成总结或推荐话术。
- 相关符号：`app/review/page.tsx`、`ReviewWorkspace`、`ConnectionCard`、`ThoughtNavigation`、`ThoughtWorkspace`、entry DOM锚点
- 验证入口：未开启、已开启无候选、有候选、有已保留联系、分页失败分别回放；手机和桌面都能从“以前的想法”进入并回到两端原文。
- 边界与不变约束：页面没有输入框；待判断数量只在回看入口旁克制提示，不弹窗、不抢焦点、不阻断记录。

#### 回看开关与隐私说明

- 需求/验收：默认关闭，明确开启后才发送跨想法内容，关闭后新保存不再处理。
- 实现目标：`retniw-web`，用一个可访问的开关表达真实状态，不使用一次性浏览器标记。
- 实现：首次进入关闭状态时显示处理范围和“开启并开始串联”按钮；点击后先持久化偏好，只有偏好成功开启才调用主动扫描。已开启时提供“再串联一次”和“暂停自动串联”，偏好保存、扫描、分页和候选判断互斥，失败保留真实服务端状态。登录页同步说明：主动使用当前想法AI，或开启回看后，必要内容会交给DeepSeek处理。
- 相关符号：`ReviewWorkspace`内的偏好控制、`app/login/page.tsx`
- 验证入口：新账号、已有账号、跨设备重登、开启失败和关闭失败；未开启连续保存三次时Network中没有DeepSeek回看请求。

#### 主动串联已有想法

- 需求/验收：用户不需要先新增一条内容，就能在回看中主动寻找既有想法之间的联系；当前想法AI仍只读当前内容。
- 实现目标：`retniw-web`提供唯一显式入口，`retniw-api`复用既有候选和用户判断链路，不新增第二套关系模型或聊天上下文。
- 实现：`POST /api/review/scan`先读取偏好，未开启时不读取历史；已开启时读取当前账号最多20条`deleted_at is null`、摘要来源为`user | import`的最近想法，可包含归档，并为每条想法补入最新user/import entry。`listBlockedPairs`持续排除`pending / confirmed`组合，以及两端最新内容都不晚于`decided_at`的`rejected`组合。单次调用`DeepSeekTextProvider.findConnectionPairs`，只接受候选集内最多3个不重复、非自连接、未被阻止的想法对和每条不超过300字的依据。两端使用各自最新user/import entry作为锚点，持久化复用`ThoughtConnectionRepository.createCandidate`，结果进入`pending`。
- 相关符号：`ReviewWorkspace`、`POST /api/review/scan`、`ReviewService.scanExistingThoughts`、`ThoughtRepository.listReviewCorpus`、`EntryRepository.latestUserEntry`、`ThoughtConnectionRepository.listBlockedPairs`、`DeepSeekTextProvider.findConnectionPairs`
- 验证入口：关闭状态不读历史、不调用模型；少于2条想法不调用模型；输入上限20条、每条500字、结果上限3条；未知ID、自连接、重复pair、受阻pair和超长依据全部拒绝；`rejected`组合在两端内容不变时受阻、有新内容时可重新判断；供应商失败可重试且不记录正文；候选两端均能打开原文。
- 边界与不变约束：主动扫描不调用`claimForReview`，不消耗保存后处理的entry认领状态；不创建用户正文或AI正文，不自动确认关系，不读取AI摘要、已删除内容或其他账号内容。

### 后端与数据

#### 新请求永久删除

- 需求/验收：确认后物理删除当前用户的可见想法及从属内容；历史软删除数据继续隐藏且不批量清理。
- 实现目标：`retniw-api`，把数据生命周期从可恢复状态改为明确删除请求。
- 实现：`ThoughtRepository.deleteOwned(userId, thoughtId)`调用`retniw_delete_thought`；函数以`user_id + thought_id`取得事务级咨询锁，写入`deleted_thought_tombstones`后物理删除thought，由外键级联清理正文、检查点、联系和行为。`retniw_ensure_thought`使用同一把锁并先检查墓碑，已删除ID返回`THOUGHT_DELETED`，不会重新创建。`DELETE`成功返回204；`PATCH`只接受move/archive/unarchive；所有合集、详情、回看和导出查询继续显式排除`deleted_at is not null`的历史行。
- 相关符号：`ThoughtRepository.ensure`、`ThoughtRepository.deleteOwned`、`retniw_ensure_thought`、`retniw_delete_thought`、`deleted_thought_tombstones`、`DELETE /api/thoughts/:id`、`ThoughtExportRepository`
- 验证入口：本人可见想法删除204；重复删除、旧软删除ID和其他账号ID均404；删除后entries、checkpoints和两端connections为0；使用删除前相同thoughtId和请求ID重放创建返回409且不产生thought；归档想法仍可删除。
- 边界与不变约束：不提供恢复端点，不运行历史`deleted_at is not null`清理；删除失败不在前端伪装成功。

#### 用户级回看偏好

- 需求/验收：没有偏好记录和已有偏好记录都按同一默认值解释；明确开启和关闭随账号跨设备同步。
- 实现目标：`retniw-api`，新增user_review_preferences作为唯一用户级开关，不向每个thought复制状态。
- 实现：没有偏好行等价于`enabled=false`；`ReviewPreferenceRepository.set`以`user_id`幂等upsert布尔值和`updated_at`。所有读取和写入先认证，匿名401，其他账号资源不暴露。
- 相关符号：`ReviewPreferenceRepository`、`GET /api/review`、`PATCH /api/review/preference`
- 验证入口：无行默认false；开启、关闭、重复提交和跨设备读取；第二账号不共享；删除测试账号后偏好行为0。
- 状态传导：
  - 删除：
    - 代码入口：Supabase Auth账号删除、`ReviewPreferenceRepository`
    - 新引用结构：`user_review_preferences.user_id`保存`auth.users.id`
    - 风险：账号删除后留下无主体的回看开关
    - 传导/清理方案：外键`on delete cascade`
    - 验证：删除临时账号后按`user_id`查询偏好表，预期0行

#### 保存后的有界回看

- 需求/验收：开启后保存仍立即完成；最多生成三条有两端原文依据的候选，失败不影响保存和继续输入。
- 实现目标：`retniw-api`，抽出ReviewService.processSavedEntry，让普通保存与模型处理只有“成功entry标识”这一条单向依赖。
- 实现：当entry、touch和摘要步骤全部成功且类型为`user | import`时，无论本次entry是新建还是幂等重放，都在组装成功响应前调用`after(() => processSavedEntry({userId, thoughtId, entryId, processedThrough}))`；两个路由设置`maxDuration=60`。`processedThrough`只保留保存结果中的时间信息，不参与认领判断。后台先读偏好，关闭时立即返回；开启后调用`EntryRepository.claimForReview(userId, thoughtId, entryId)`，用`user_id + thought_id + id + entry_type in (user, import) + review_checked_at is null`一次更新并返回源entry。没有返回行表示同一entry已被处理、越权或属于AI entry，回调立即结束；不同entry各自拥有认领列，不受创建时间和`after()`到达顺序影响。认领成功后，以返回entry前2000字为源，以最多20个`deleted_at is null`且可含归档的thought首段摘要（每条最多500字）为候选；排除当前thought、`pending / confirmed`组合，以及两端都没有忽略后新内容的`rejected`组合。排除集合只接受合法UUID，并在数据库查询中先执行`id not in (...)`再`limit 20`，避免受阻关系占满召回窗口。DeepSeek超时45秒，只能返回候选集内0至3个target thought ID和每条不超过300字的依据；目标锚点取该thought首条user/import entry，持久化仍走`createCandidate`。
- 相关符号：`POST /api/thoughts`、`POST /api/thoughts/:id/entries`、`ReviewService.processSavedEntry`、`EntryRepository.claimForReview`、`DeepSeekTextProvider.findConnections`、`ThoughtRepository.listReviewCandidates`、`EntryRepository.firstUserEntry`
- 验证入口：保存响应时间不包含模型等待；开关关闭不认领、不读取候选且不调用DeepSeek；同一entry幂等重放只认领一次，不同entry无论回调顺序都各认领一次，AI entry不可认领；归档可入选、软删除不可入选；0/1/3/越界/伪造ID模型结果；超时和供应商错误只留下服务端无正文错误记录。
- 边界与不变约束：不增加队列、定时任务、向量库或第二模型；不发送AI entry、checkpoint、合集名、账号标识或其他账号内容；日志只记用户无关的结果码与耗时。

#### 候选幂等、竞态与全局读取

- 需求/验收：忽略收起当前理由，两端内容不变时不再出现，任一端新增user/import内容后可以重新判断；保留后持续可见；并发保存不产生重复边。
- 实现目标：`retniw-api`，以entry级原子认领隔离后台回调，再复用thought_connections的规范化pair和三态完成关系幂等与批量列表。
- 实现：[`ThoughtConnectionRepository.createCandidate`](src/server/repositories/thought-connection-repository.ts#ThoughtConnectionRepository)先规范化两端顺序，遇到既有pair或23505竞态时读取已有记录；`decide`只允许`pending`一次性进入`confirmed / rejected`。`listBlockedTargets`和`listBlockedPairs`持续阻止`pending / confirmed`组合；`rejected`只有在新锚点时间晚于`decided_at`时才可重新进入模型候选。模型给出候选后，`createCandidate`再次校验两端锚点，并拦截与上次文本相同的理由；符合条件时复用原pair ID，更新锚点、理由和建议时间，并以`status + decided_at`条件更新回到`pending`，不会覆盖并发进入的其他状态。`EntryRepository.claimForReview`继续保证同一entry只处理一次。`listForReview(status, cursor)`通过四个精确外键做`!inner`嵌入，在`limit 21`前过滤两端`deleted_at is null`及两端锚点`entry_type in (user, import)`，然后直接序列化最多20条、每端最多1000字的页面数据。`countForReview`复用相同可见性查询并使用`count: exact, head: true`；`rejected`不返回页面。
- 相关符号：`EntryRepository.claimForReview`、`EntryRepository.latestUserEntry`、`ThoughtConnectionRepository.listBlockedTargets`、`listBlockedPairs`、`createCandidate`、`listForReview`、`countForReview`、`GET /api/review`、`PATCH /api/thought-connections/:id`
- 验证入口：开关关闭不认领；同entry幂等重放只处理一次；AI entry不可认领；同pair并发插入最多一行；`rejected`在无新内容时保持关闭、有新内容时复用原行回到`pending`；`pending / confirmed`不被覆盖；删除任一端后列表和计数都不包含该关系。
- 边界与不变约束：回看不是一次生成的报告，不保存页面快照；所有状态的关系都随两端thought物理删除而级联清理。

#### 第一方使用行为

- 需求/验收：能够区分进入工作区、打开回看、主动串联结果和从联系打开原文；行为记录失败不影响对应产品动作。
- 实现：`VisibleProductEvent`在页面可见时发送`workspace_active_day / review_opened`；两者按`user_id + event_name + event_day`去重，`event_day`由`occurred_at`按`Asia/Shanghai`生成。`POST /api/review/scan`返回扫描结果后，通过Next `after()`记录固定`scan_status`和0至3的`created_count`。打开联系原文时发送`connection_opened`，服务端校验connection归属及thought属于该connection。扫描结果事件和原文打开事件使用`client_request_id`幂等。
- 数据边界：`product_events`只包含固定事件字段，不接收自由JSON；正文、AI输入输出和账号资料不进入事件行。用户、thought或connection物理删除时，相应事件级联删除。
- 聚合：`npm run metrics:product`读取必要标识、类型、状态和时间。24小时首次写入、跨日继续和同一thought追加只统计`user` entry；导入人数和导入段数单独统计。报告同时输出AI保存结果、checkpoint、回看与联系等聚合结果，不输出用户、thought或entry标识。
- 相关符号：`ProductEventRepository`、`POST /api/product-events`、`VisibleProductEvent`、`recordConnectionOpened`、`scripts/report-product-metrics.mjs`
- 验证入口：事件形状、用户归属、上海自然日去重、请求幂等、迁移缺失与0行区分、事件失败不阻断主流程、聚合结果不含输入标识。

### 数据库 DDL

```sql
create table public.user_review_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_review_preferences enable row level security;

alter table public.entries
  add column if not exists review_checked_at timestamptz null;

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  event_day date generated always as (
    (occurred_at at time zone 'Asia/Shanghai')::date
  ) stored,
  client_request_id uuid,
  thought_id uuid,
  connection_id uuid,
  scan_status text,
  created_count smallint
);

create table public.deleted_thought_tombstones (
  user_id uuid not null references auth.users (id) on delete cascade,
  thought_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, thought_id)
);

-- retniw_ensure_thought和retniw_delete_thought对同一user_id + thought_id
-- 使用同一事务级咨询锁。表级触发器兼容仍在运行的旧实例：删除必写墓碑，
-- 插入前若命中墓碑则抛出RETNIW_THOUGHT_DELETED。
```

## 契约

### 页面与数据契约

```ts
type ThoughtAction =
  | { action: 'move'; collectionId: string | null }
  | { action: 'archive' | 'unarchive' }

type ThoughtScope = 'active' | 'archived'

type ReviewPreference = {
  enabled: boolean
  updatedAt: string | null
}

type ReviewConnection = {
  id: string
  status: 'pending' | 'confirmed'
  source: { thoughtId: string; entryId: string; excerpt: string }
  target: { thoughtId: string; entryId: string; excerpt: string }
  rationale: string
  decidedAt: string | null
  createdAt: string
}
```

- `/review`是认证后的动态页面；未登录重定向`/login`，不存在公开分享或缓存。
- `/auth/created`只读取认证状态；无有效会话时返回`/login`，有会话时进入工作区。
- `updateNickname`只更新当前会话对应用户的`user_metadata.nickname`；留空清除，验证、更新或会话刷新失败都返回可见状态。
- `GET /api/thoughts`只接受`scope=active | archived`和可选`collectionId/cursor`；`deleted`返回400。
- `PATCH /api/thoughts/:id`只执行`ThoughtAction`；`DELETE /api/thoughts/:id`成功204，非法ID 400，不存在、已软删除或非本人资源404，约束冲突409。
- `GET /api/review?status=pending|confirmed&cursor=`返回`preference/connections/nextCursor`；默认pending，每页20条。`pendingCount`只在pending首屏返回，confirmed和带cursor的后续页省略，避免重复exact计数。
- `PATCH /api/review/preference`只接受`{enabled:boolean}`，返回`ReviewPreference`；重复设置同值成功且更新时间不倒退。
- `POST /api/review/scan`接受可选`{requestId:uuid}`作为事件幂等键；偏好关闭返回`disabled`，少于2条可用想法返回`not-enough-content`，供应商失败返回可重试的`provider-failed`，候选持久化失败返回可重试的`persistence-failed`及已成功保存数，全部处理完成后返回`processed`及本次实际新增候选数。
- `POST /api/product-events`只接受`workspace_active_day`、`review_opened`和带`requestId / connectionId / thoughtId`的`connection_opened`；`review_scan_finished`只由扫描路由按服务端结果写入。
- `PATCH /api/thought-connections/:id`沿用`{decision:'confirmed'|'rejected'}`；只有pending可决定，重复同一决定幂等成功，相反决定409。
- 结构化导出继续只包含confirmed关系；thought、entry、checkpoint和connection查询都以未删除thought为集合边界。为兼容`retniw.export.v1`，`deletedAt`字段暂时保留但导出值只会为null。

## 风险与运行边界

- 指向`thoughts`的`entries`、`thought_checkpoints`和`thought_connections`外键必须使用`ON DELETE CASCADE`，且不能存在未纳入清理语义的其他子引用。删除墓碑只保存`user_id / thought_id / deleted_at`，随账号删除级联清理；新代码通过同一组数据库事务函数创建和删除，表级触发器同时保护旧实例直写与发布回滚，不能退回无锁的应用层多步写入。仓库不包含基础数据表的完整初始化迁移。
- Web版本依赖`20260903143000_thought_identity_tombstones.sql`、`20260904084500_thought_identity_trigger_guards.sql`和`20260904091000_thought_identity_account_delete_guard.sql`。三条迁移必须先于Web发布完成，并验证迁移登记、RLS、函数权限、触发器启用、“直接删除后同ID直写被拒绝”和“账号删除可级联清理”；否则不得切流。
- `after()`没有持久队列的重试保证；每条entry在模型调用前独立认领，同一entry的供应商失败不会自动重试，换来幂等重放不重复调用模型。不同entry不共享时间水位，回调乱序不会漏掉较早保存的entry。如果这一可靠性边界无法满足实际使用，再引入持久任务机制。
- 保存后回看以源entry 2000字、20个thought摘要、每条摘要500字、最多3个结果限制模型输入和写放大；主动扫描以最多20个thought摘要与最新user/import entry、每条500字和最多3个pair为上限。`pending / confirmed`持续排除，`rejected`在任一端出现晚于决定时间的新内容后可重新判断。页面关系查询用内连接先过滤再取21条判定下一页并直接序列化20条，pending精确计数只发生在首屏。阈值调整不得改变默认关闭和原文锚点边界。
- 首页、想法详情和回看页在服务端并行读取最近想法与合集；合集首读成功时不再水合后重复请求，首读失败时客户端只补拉一次。回看页同时并行读取偏好、pending首屏及计数、confirmed首屏，并随首个RSC响应下发，客户端只在首读失败、加载更多或操作后再请求接口。想法详情与回看路由使用各自的`loading.tsx`提供即时反馈；历史列表继续关闭全量视口预取，只在用户指向、聚焦或触摸某一条时预取该目标路由。
- 关闭回看阻止关闭之后保存触发的新任务；已经进入DeepSeek调用的任务无法撤回已发送内容，但返回结果仍只形成pending候选，不会自动保留或改写内容，关闭前已有候选可继续处理。
- 代码回退不会恢复已经物理删除的数据。历史软删除行必须继续保持隐藏，回退方案也要保留这一读取边界。
- DeepSeek错误、超时和非法响应不得记录原文或供应商响应正文；用户页面不弹阻断提示，只在之后进入回看时看到真实候选状态。
- `product_events`写入失败只记录固定事件名，不改变工作区、回看、扫描或原文跳转结果。

## 验证映射

| 需求/验收 | 设计落点 | 验证方式 | 证据/环境 |
| --- | --- | --- | --- |
| 创建账号后自动进入，顶栏回显邮箱并支持昵称。 | 认证过渡页、`AppHeader`、昵称Action和提示词边界 | 创建、自动进入、邮箱回显、昵称保存/清除/会话失效、恶意昵称 | Action和Provider测试；认证后浏览器 |
| 侧栏展开/收起不留多余空白，主区运动不反向或过冲，移动端不渲染桌面窄轨。 | 桌面全宽外壳、同构五轨网格、52像素收起轨道、900像素分界 | 320、390、900、901、1440、1470像素；逐帧检查展开/收起、快速反向、减少动态效果及旋转 | UI测试与浏览器尺寸、轨迹检查 |
| 进入归档后不出现“全部”或“已删除”标签；取消归档后回到最近内容，合集归属不变。 | `retniw-web`历史根与归档 | 根、空归档、有内容归档、取消归档、移动面板回放 | Chromium与WebKit；320、375、1024、1440像素 |
| 所有删除入口都先强提醒，确认后无法恢复，想法、内容和相关联系不可再读取。 | `retniw-web`删除交互；`retniw-api`DELETE | 四种入口、取消、单次提交、404/409、删除后深链和关联行检查 | 自动测试、Supabase集成环境、桌面与移动浏览器 |
| 首次开启前说明处理范围；候选可回到两端原文，保留的联系可再次打开；页面不被理解为聊天。 | `retniw-web`独立回看；`retniw-api`全局关系读取 | 未开启、候选、已保留、两端深链、无输入框 | API/UI测试、Chromium与WebKit |
| 用户能识别初始输入和继续写区域，两处容器与聚焦视觉一致，不依赖低对比占位文字猜测入口。 | `retniw-web`共用ThoughtComposer的initial/continuation模式和容器视觉 | 空白页、详情页、默认态、聚焦态和键盘可访问性 | UI测试；320、390、620、900、1440像素浏览器 |
| 默认关闭，明确开启后才发送跨想法内容，关闭后新保存不再处理。 | `retniw-web`回看开关；`retniw-api`偏好表 | 无偏好记录和已有偏好记录的默认值、开启/关闭失败回滚、退出重登、第二设备读取 | Repository/API测试、Supabase集成环境 |
| 不新增内容也能主动串联既有想法；失败可重试，结果仍由用户判断。 | `retniw-web`开始串联；`retniw-api`显式scan和既有pending链路 | 关闭、少于2条、0至3条、非法pair、供应商失败、重复扫描 | Service/API/UI测试；认证后浏览器验收 |
| 确认后物理删除当前用户的可见想法及从属内容；历史软删除数据继续隐藏且不批量清理。 | `retniw-api`DELETE与未删除过滤 | 204/404/409、关联行、旧软删除ID和无清理脚本 | Repository/API测试、Supabase集成环境 |
| 没有偏好记录和已有偏好记录都按同一默认值解释；明确开启和关闭随账号跨设备同步。 | `retniw-web`偏好控制；`retniw-api`偏好表 | 无偏好记录、已有偏好记录、重复提交、退出重登、第二设备读取 | API/UI测试、Supabase集成环境 |
| 开启后保存仍立即完成；最多生成三条有两端原文依据的候选，失败不影响保存和继续输入。 | `retniw-api`after回调和ReviewService | 延迟45秒模型桩，0至3结果，模型失败时原文仍同步 | Route集成测试、浏览器Network |
| 忽略后两端内容不变时不再出现，任一端新增原文后可以基于新依据重新判断；保留后持续可见。 | `retniw-api`entry认领、关系幂等与rejected条件更新；`retniw-web`回看 | 无新内容、有新内容、pending/confirmed保护、同pair并发、保留/忽略刷新 | Repository并发测试、Supabase集成环境、浏览器 |
| 四类行为事件口径固定且不阻断产品动作，聚合结果不含用户或内容标识。 | `product_events`、事件API与聚合脚本 | 日去重、请求幂等、归属校验、固定字段、级联删除、迁移缺失、0行和聚合输出 | Schema、Repository、API、UI与聚合脚本测试 |
| 回看列表、计数和候选召回先过滤再分页，不因无效关系或已有pair出现空页、漏项或重复重查。 | `retniw-api`四FK内连接、exact head计数、候选排除下推 | `!inner`过滤顺序、21/20分页、pending首屏计数、合法UUID排除后limit20 | Repository查询测试、PostgREST集成检查 |
| 删除、回看和导出不泄露旧软删除或他人内容 | `retniw-api`所有权与未删除过滤 | 匿名401、跨账号404、旧软删除ID、导出内容和回看列表检查 | 自动测试、Supabase集成双账号夹具 |
| 当前想法AI仍由用户主动调用且只读当前内容 | `retniw-web`当前工作区；`retniw-api`现有AI路由 | 未点击无请求，点击后请求上下文不含其他thought，回看开关互不影响 | AI route测试、浏览器Network |

## 设计假设

- 候选召回按最近活动读取最多20个未删除历史摘要；这不是完整个人图谱覆盖。
- `thought_connections`三态和pair唯一语义是关系真相源；不支持解除已保留联系、手动建边或图谱可视化。
- 邮箱密码账号、单层合集、checkpoint和当前想法流式AI的隐私与删除边界以本文契约为准。
