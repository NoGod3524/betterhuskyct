# BetterHuskyCT

**把你的课程 deadline 整理清楚。** 点一下「同步」，你在 HuskyCT 上的 deadline、公告、课程文件和成绩就会汇到一份清晰有序的「接下来要交什么」里。

[English](./README.md) | **简体中文**

[**在线演示**](https://betterhuskyct.vercel.app/) · [更新日志](./CHANGELOG.md) · [反馈问题](https://github.com/NoGod3524/betterhuskyct/issues)

[![CI](https://github.com/NoGod3524/betterhuskyct/actions/workflows/ci.yml/badge.svg)](https://github.com/NoGod3524/betterhuskyct/actions/workflows/ci.yml)

![BetterHuskyCT](./public/og.png)

## 界面截图

**总览** —— 点「同步」，然后是滚动的本周视图。

![总览页](./public/screenshots/overview.zh.png)

**安排** —— 今天 / 明天 / 本周，可勾选完成。

![安排页](./public/screenshots/tasks.zh.png)

英文界面：[`overview.png`](./public/screenshots/overview.png) · [`tasks.png`](./public/screenshots/tasks.png)

## 为什么做这个

学生的 deadline 散落在教学平台、课程大纲和邮件里。BetterHuskyCT 把 HuskyCT 本来就摆在你面前的东西，变成一份滚动的未来 7 天任务清单——「接下来要交什么」一眼可见，不用到处翻。

它刻意做得小而注重隐私：不需要 NetID、不需要密码、不需要注册账号，除了你主动让 AI 读的文字，什么都不会离开你的浏览器。

BetterHuskyCT 是在 UConn 对着 HuskyCT（Blackboard）做的，而它恰好是最难搞的那一档：**一门课一条订阅**，而且作业条目完全不写课程名。浏览器助手在你自己已登录的会话里读取这些，见[怎么把 deadline 接进来](#怎么把-deadline-接进来)。

## 功能

- **自动填上课程号** —— Blackboard 的订阅只写「Environmental Science」不写课号，所以 App 会去 UConn 公开的课程目录里查，自己填上 `NRE 1000E`。不用任何配置
- **多个日历、多门课** —— HuskyCT 是每门课一条订阅，一次同步全部带回来；每条订阅归到一门课（课程代码 + LEC / DIS / LAB / SEM），任务行就会显示它属于哪门课、是「上课」还是「作业」、在哪个教室、精确到分钟的截止时间；默认不对的那条可以单独改
- **滚动 7 天视图** —— 今天 / 明天 / 本周，分组并按时间排序
- **到期提醒** —— 未来 24 小时有任务到期时显示横幅；可选开启浏览器通知（App 打开时生效）
- **可安装 + 离线** —— 作为 PWA 加到手机主屏幕，没网也能看已保存的任务
- **课程公告** —— 浏览器助手在送 deadline 的同一按里把课程公告一起带来，按课程分组、最新的在最前
- **公告总结** —— 选一门课，按一下就把它的公告浓缩成要点（截止日期、考试、调课停课），用你的界面语言，任何设备都能用。由 Z.ai 的免费 GLM 模型生成，GLM 忙时改用 Google Gemini 免费版，再忙改用 Groq；按下之前页面就写明每家分别会怎么处理这些内容，不按就什么都不发。按钮旁边的「模型」菜单可以把它固定为仅 Z.ai、仅 Gemini 或仅 Groq，代替自动顺序；选定的模型就是你的文本唯一会发给的那一家，不会悄悄改用另一家，这个选择只保存在这个浏览器里
- **课程用 HuskyCT 里的颜色** —— 助手在 HuskyCT 的 Courses 页读出每张课程卡片的颜色（一键收集时，以及同步时 HuskyCT 正好在这个页面），随截止日期一起送过来；待办、仪表盘、日历里的课程标签和待办的课程筛选都用这个颜色。读不到颜色的课程保留本应用自己分配的颜色
- **AI 找日期** —— 在待办页开启后，它会读一次课件里的 syllabus（名字像 syllabus 的 PDF 或 Word 文件，另有单独的课程安排也一起读），每条新公告也读一次，列出里面的考试、截止日期、停课和要做的事，每项附上原文。你勾选要留下的，日期不对可以改，没勾的会被忽略；确认之前什么都不会进日历。有日期的变成日历事件，所以也会出现在待办里；没日期的（比如「买课本」、只写了「第 5 周」的考试）放进待办的 **无日期** 组。原文的星期几和日期对不上（多半是去年的 syllabus）、或者日历里已经有的，会标出来。同一次读取还会用你的界面语言总结每份 syllabus（成绩构成、考试、迟交、出勤、AI 使用规定），显示在课件页对应课程的最上面。用的是和公告总结同样的模型和 **Model** 选择
- **日历里的 UConn 校历** —— 教务处的日期直接叠加在月历上，所有人都有，不需要助手：假期、开课和最后一天上课、加退课、退课和 Pass/Fail 截止、复习日和期末考试会把整天标成醒目的颜色，选课开始等其余日期安静地显示。只和学位申请人、教职员工有关的日期不显示。服务器每天从 registrar.uconn.edu 读一次，读不到时用保存的备份
- **完成勾选** —— 勾选任务；状态存在浏览器里，刷新不丢
- **待办完成率** —— 整学期的完成情况，总体与各课程
- **English / 简体中文** —— 一键切换语言，选择会被记住
- **本地持久化** —— 再次同步，勾选状态会保留
- **隐私优先设计** —— 不要 NetID、不要密码、不要账号。助手带来的一切只存在这个浏览器里

## 怎么把 deadline 接进来

点页面顶部的**同步**。第一次需要先设置浏览器助手（「助手」页一步步带你做）：一个 Tampermonkey 用户脚本，或者一个手动加载的 Chrome / Edge 小扩展。它在 HuskyCT 自己的页面上、用你已登录的会话读取各门课的 deadline、公告、文件和成绩，再在标签页之间交给这个页面。页面只接受来自 HuskyCT 自己域名的数据。

## 架构

一个把数据留在浏览器里的 Next.js 应用。服务端只有三个小接口，不存任何你的数据：

- `/api/announcements/summarize` 和 `/api/plan/extract`：把你要求总结或读取的文字交给 AI 服务，并按发送内容的哈希缓存答案；
- `/api/academic-calendar`：大约每天读一次 UConn 教务处的公开页面。

### 一次同步的流程

1. 你点**同步**。助手打开 HuskyCT（或用已经开着的标签页），通过 HuskyCT 自己的页面和接口读取各门课的 deadline、公告、文件和成绩。
2. 它用 `postMessage` 发给这个页面，页面只接受来自 HuskyCT 自己域名的消息。一条消息装不下的（文件）逐个发送、逐个确认。
3. 页面把收到的和已有的按稳定的键合并，所以再次同步不会重复，并保留你的勾选、修改和备注。
4. 一切存在 `localStorage` 和 IndexedDB 里，带版本，读回来时会校验。

## 隐私模型

| 数据 | 存在哪 |
|---|---|
| 解析后的事件 | 只在你浏览器的 `localStorage` |
| 课程公告 | 只在你浏览器的 `localStorage`（由浏览器助手随 deadline 一起送来） |
| 公告总结 | 只在你按下「总结」且没有可复用的缓存时：这门课的公告（标题、正文、发布时间——不含你的信息和日历链接），把邮箱、电话、链接替换掉之后，经 BetterHuskyCT 自己的接口发给 AI 服务。先发给 [Z.ai](https://z.ai)：它在新加坡运行 GLM，API 条款写明不保存内容。Z.ai 是中国公司智谱 AI 的国际品牌，美国商务部于 2025 年 1 月将其列入实体清单（[联邦公报](https://federalregister.gov/d/2025-00704)）。该清单涉及的是出口许可，而不是限制你能用什么；写在这里，是为了让你自己判断是否放心使用这个提供方。Z.ai 忙或出错时改用 [Google Gemini 免费版](https://ai.google.dev/gemini-api/terms)：其条款允许 Google 用这些内容改进模型、人工审核员可能会看；来自欧洲经济区、瑞士、英国的请求绝不会交给它。两家都忙时改用 [Groq](https://console.groq.com/docs/your-data)：美国公司，条款写明不拿发送的内容训练，只在调查滥用时保存；只会发给它约 8000 token 以内的请求。接口不记录任何公告文本。总结在服务器内存里最多缓存 6 小时；配置 Upstash Redis 后，也会在服务实例之间共享。共享缓存只存 SHA-256 哈希键、总结、模型提供方和原始生成时间，不存原公告、IP 地址、请求明文或凭据 |
| AI 找日期 | 默认关闭。开启后，syllabus 的文字在你的浏览器里读出，和每条新公告一起，先把邮箱、电话和链接替换掉，再经 BetterHuskyCT 自己的接口（`src/app/api/plan/extract`）发给和公告总结相同的 AI 服务，条款同上。接口不记录任何文字，结果（日期和 syllabus 要点）和总结一样按发送内容的哈希缓存，最多保存 120 天，这样同一门课的同学共用一次读取。清单和你的选择存在 `localStorage`；加进去的事件和你在日历上自己加的事件存法一样 |
| UConn 校历 | 不涉及你的任何信息：服务器大约每天读一次教务处的公开页面，所有访客拿到的都一样；最近一份存在 `localStorage`，离线也能看 |
| 已完成的任务 ID | 只在你浏览器的 `localStorage` |
| 语言选择 | 只在你浏览器的 `localStorage` |

没有 NetID、没有密码、没有账号、没有统计埋点。日历数据存在你的浏览器里；唯一可选的服务端数据库是上述总结缓存。「清空已保存数据」会把日历和勾选状态一起清掉。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router） |
| 语言 | TypeScript，测试用原生类型擦除（type stripping） |
| 界面 | React 19、Tailwind CSS 4、lucide-react |
| 校验 | Zod |
| 测试 | Node 内置测试运行器（`node --test`） |
| 部署 | Vercel |

## 项目结构

```text
src/
├─ app/
│  ├─ layout.tsx                     # 元数据、主题、状态 Provider、常驻外壳
│  ├─ manifest.ts                    # PWA 清单（可安装）
│  ├─ page.tsx                       # /          总览
│  ├─ tasks/page.tsx                 # /tasks     滚动 7 天清单
│  ├─ calendar/page.tsx              # /calendar  再加一个日历
│  ├─ announcements/page.tsx         # /announcements 课程公告
│  ├─ helper/page.tsx                # /helper    安装浏览器助手
│  ├─ globals.css
│  └─ icon.tsx
├─ components/
│  ├─ calendar-provider.tsx          # 全部应用状态，挂在根布局
│  ├─ app-shell.tsx                  # 侧边栏、页头、页脚
│  ├─ connect-section.tsx            # 已连接的日历、课程列表、怎么连接
│  ├─ helper-section.tsx             # 怎么安装浏览器助手
│  ├─ tasks-section.tsx              # 任务分组与卡片
│  ├─ task-card.tsx                  # 单条任务：标签、时间、教室、课程下拉
│  ├─ course-picker.tsx              # 单条任务的课程覆盖
│  ├─ announcements-section.tsx      # 课程公告：按课程分组、可筛选
│  ├─ hero-section.tsx               # 总览页头部与状态行
│  ├─ app-footer.tsx                 # 版本号页脚
│  └─ service-worker-registrar.tsx   # 注册离线 Service Worker（仅生产环境）
└─ lib/
   ├─ calendar-view.ts               # 分组（今天 / 明天 / 本周）与时间格式化
   ├─ calendar-types.ts              # 共享类型
   ├─ date-utils.ts                  # 共享的本地日期工具
   ├─ effort.ts                      # 每条任务的工作量估计
   ├─ courses.ts                     # 课程列表、单条覆盖、1.0.1 数据迁移
   ├─ export.ts                      # CSV 导出
   ├─ reminders.ts                   # 到期检测与提醒设置
   ├─ subscriptions.ts               # 日历列表：缓存的事件、名字、归到哪门课
   ├─ announcements.ts               # 课程公告：派生 ID、上限、存储
   ├─ completion-storage.ts          # 带版本的 localStorage（已完成的任务 ID）
   └─ i18n.ts                        # 中英文字典与查表函数
public/
├─ sw.js                             # 离线应用外壳 Service Worker
└─ icons/                            # PWA 图标（192 / 512 / maskable）
tests/                               # node:test 测试
```

## 本地运行

需要 **Node.js 22+**（测试脚本依赖原生 TypeScript 类型擦除）。

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 解析、分组、URL 拦截、存储
npm run lint
npm run build
npm run course-map   # 重新抓取 UConn 课程目录（每学期一次）
```

### 公告总结（可选）

总结功能按顺序使用最多三家的免费模型。配其中任意几个 key 都可以；一个都不配的话，应用照常工作，只是不显示总结按钮。

| 环境变量 | 服务方 | 模型（可用此变量替换） |
|---|---|---|
| `ZAI_API_KEY` | [Z.ai](https://z.ai)——优先使用 | `glm-4.7-flash`（`ZAI_MODEL`） |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey)——Z.ai 忙或出错时使用 | `gemini-3.5-flash-lite`（`GEMINI_MODEL`） |
| `GROQ_API_KEY` | [Groq](https://console.groq.com/keys)——前两家都忙或出错时使用；只接收约 8000 token 以内的请求 | `openai/gpt-oss-120b`（`GROQ_MODEL`） |

1. 分别在两家的控制台里创建 key。
2. 在 Vercel 的 **Settings → Environment Variables** 里添加，或者本地写进 `.env.local`（已被 git 忽略）。
3. 重新部署（或重启 `npm run dev`）。公告页是预渲染的，key 在构建时才会被识别。

key 只在服务端由 `src/app/api/announcements/summarize` 读取，从不发给页面。命中缓存会直接复用总结，不消耗模型额度。默认每个服务实例在内存里缓存最多 500 条总结，保留 6 小时。下面的可选共享缓存支持不同实例和冷启动复用；多个请求同时未命中时，仍可能生成多次总结。请求限流仍按实例执行，Gemini 的地区限制继续生效。

同样的 key 也会启用 **AI 找日期**（`src/app/api/plan/extract`），它读 syllabus 或一门课的公告，用 JSON 回答。每人每分钟最多 4 次请求；每门课的 syllabus 只发一次。

### 共享总结缓存（可选）

在 [Upstash 控制台](https://console.upstash.com) 创建 Redis 数据库，再复制其 HTTPS REST URL 和有写权限的 token（不要用只读 token）。详见 [Upstash REST API 文档](https://upstash.com/docs/redis/features/restapi)。

| 环境变量 | 值 |
|---|---|
| `UPSTASH_REDIS_REST_URL` | 数据库的 HTTPS REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 有读写权限的 REST token |

把两个变量都添加到 Vercel 的 **Settings → Environment Variables**，或项目根目录的 `.env.local`，然后重新部署或重启开发服务器。它们是服务端凭据，不要加 `NEXT_PUBLIC_` 前缀，也不要提交到 git。缺少任一变量时继续使用本地缓存；Upstash 出错或短超时后自动回退本地缓存。共享缓存条目 6 小时后过期，只包含哈希键、总结、模型提供方和原始生成时间。

`npm run course-map` 读的是 UConn 公开的选课搜索——不需要登录、不需要 token——重写 `src/lib/ucc-courses.json`。这张表就是「Environmental Science 自动认出 NRE 1000E」的依据。课号和课名几年才变一次，每学期跑一次足够。也可以只抓某个学期：`npm run course-map -- 1268`。

## 设计取舍

- **每个存储结构都带版本号。** 每条 `localStorage` 都是带版本、经过结构校验的对象；损坏的数据会被丢弃（并告知用户），而不是让页面崩溃。
- **完成状态按事件 ID 记录。** ID 由事件的 UID 加开始时间生成，所以再次同步能保留勾选状态；但如果源日历改了某个事件的开始时间，它的 ID 会变、勾选会重置（已知限制）。
- **滚动 7 天，而不是自然周。** 这个应用回答的是「接下来要交什么」，不是「这周日历格子上有什么」。
- **不引入 i18n 库。** 字符串集合有限且不大，两份字典加一个查表函数就够了。
- **提醒只在 App 打开时生效。** 真正的后台推送需要推送服务器和订阅存储，这是本项目刻意避开的。所以提醒做成「App 内横幅 + 可选通知」，并用任务指纹去重，不会重复轰炸。
- **离线指的是应用外壳，不是数据。** Service Worker 对页面导航走网络优先（保证新部署立刻生效）、对带哈希的静态资源走缓存优先；任务数据本来就在 `localStorage` 里。

## 测试

`npm test` 用 Node 原生的 TypeScript 类型擦除运行 `node:test` 测试，不需要打包器或测试框架。覆盖范围包括：助手的消息及其校验、合并、分组、公告规则，以及带版本的存储模块。

## 项目背景

BetterHuskyCT 最初是一个自用工具。deadline 散落在 HuskyCT、课程大纲和邮件里，而现成的方案要么要交出 NetID，要么索取了远超「看一眼日历」所需的权限。这个项目想把这件事做到又窄又诚实：输入你自己的 HuskyCT 会话，得到一份清晰的清单，数据留在你自己的设备上。可选的公告总结遵循上面的隐私模型。

## 路线图

- [x] CI：每个 Pull Request 自动跑 `test` / `lint` / `build`
- [x] 待办页完成率：总体与各课程（取代原洞察页）
- [x] 可安装的 PWA（含离线应用外壳）
- [x] 到期提醒（App 打开时生效）
- [x] 导出任务为 CSV
- [ ] 后台推送提醒（需要推送服务器）

## 作者

由 [Yinuo (NoGod3524)](https://github.com/NoGod3524) 构建，一名 UConn 学生。

## 免责声明

BetterHuskyCT 是独立的个人学生项目，**与康涅狄格大学、HuskyCT、Blackboard 官方没有任何隶属、背书或支持关系**。文中提到这些名字，只是为了说明这个工具读取的是什么。

助手通过你自己已登录的会话读取 HuskyCT，不会看到也不会发送你的密码。本应用不在服务端数据库存储日历或账号数据；可选的 Upstash 数据库只保存最多 6 小时的总结缓存。

## 作者与许可证

BetterHuskyCT 和 HuskyCT 助手由 **Yinuo**（[@NoGod3524](https://github.com/NoGod3524)）制作。源码以 [MIT](./LICENSE) 许可证开放，© 2026 Yinuo：可以使用、修改、分享，但请保留这份版权声明。

如果它帮到了你，或者你在它的基础上做了东西，点个 star 或者放一个[仓库](https://github.com/NoGod3524/betterhuskyct)的链接，别人才找得到它。
