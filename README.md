# EarthOL Player Profile

地球OL玩家档案，使用Cloudflare Worker运行

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Yang-qwq/earthol-player-profile)

## 技术栈

- **运行时**：Cloudflare Workers（`wrangler` + workerd）
- **框架**：[Hono](https://hono.dev)（SSR + JSX）
- **数据**：D1（SQLite）+ KV（会话、限流、主页 HTML 缓存、设置缓存）+ 静态资源
- **样式**：Tailwind CSS v4（CSS-first 配置，见 `src/styles/app.css`）
- **前端交互**：内联原生 JS（侧边栏抽屉、可重复表单行、主题切换、二维码 / NFC 写入、Gravatar 填充）；htmx（CDN）用于用户名可用性检查；`qrcode-generator`（unpkg，按需加载）用于二维码

## 功能

- **个人主页** `/:username`：三档可见性（`public` 可缓存 / `unlisted` 不索引不缓存 / `private` 仅本人），支持主题、头像、标语、所在地、代词、网站与 MFM 简介
- **自定义字段**：任意键值对；值是可安全识别的 http(s) 链接时渲染为超链接
- **标签**：管理员维护带颜色的分类，用户为资料挂标签；可标记「隐藏」，仅对携带相同标签的访客可见
- **分享**：主页内置二维码生成（可下载 PNG）与 WebNFC 写入，把主页链接写进 NFC 标签
- **登录**：GitHub OAuth + 邮箱魔法链接，凭已验证邮箱跨身份关联同一账号
- **控制台** `/dashboard`：编辑资料、字段、标签、主题与可见性，一键使用 Gravatar 头像
- **管理面板** `/admin`：运行时设置（站点名、favicon、功能开关、维护模式、默认主题/可见性）、保留用户名、标签分类、用户管理（授予/撤销管理员、删除）
- **i18n**：中 / 英双语，`GET /language/:code` 切换
- **安全**：CSRF 双提交校验、登录与接口限流、会话存 KV、CSP 与安全响应头
- **SEO**：canonical / OG 标签、`robots.txt`、`/sitemap.xml`

## 快速开始

前置条件：Node.js 18+、已登录的 `wrangler`（仅部署时需要）。

```bash
npm install
# Windows 上若安装脚本被拦截：npm approve-scripts 后重装（见 package.json allowScripts）

# 按需创建 .dev.vars 填写本地密钥（见下方密钥表）
npm run db:init                  # 应用 schema.sql 到本地 D1（必须先执行）
npm run dev                      # 构建 CSS 后在 http://localhost:8787 启动
```

重置本地数据库：删除 `.wrangler/state` 后重新执行 `npm run db:init`。

> 首次注册的用户会自动成为管理员（`users.is_admin=1`）；也可用 `ADMIN_EMAILS` 引导管理员。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建 CSS 并启动 `wrangler dev`（端口 8787） |
| `npm run build` | 构建 CSS（`public/styles.css`，生成物、已 gitignore） |
| `npm run build:css` | Tailwind 构建（`public/styles.css`，生成物、已 gitignore） |
| `npm run watch:css` | Tailwind watch 模式 |
| `npm run typecheck` | `tsc --noEmit`，项目唯一的自动化校验 |
| `npm run db:init` / `db:init:remote` | 应用 `schema.sql`（本地 / 远端） |
| `npm run deploy` | 构建 CSS 并 `wrangler deploy --env production` |
| `npm run cf-typegen` | 生成 Wrangler 绑定类型 |

## 配置

### 环境变量

`wrangler.jsonc` 不声明任何 `vars`，并设置 `keep_vars: true`，因此环境变量由 Dashboard 管理且不会被每次部署重置。未配置时使用代码内置默认值。

| 变量 | 说明 |
| --- | --- |
| `APP_NAME` | 站点名称，默认 `EarthOL Player Profile`（管理面板的站点名优先） |
| `APP_URL` | 站点根地址，用于魔法链接、canonical、OG 标签与 sitemap；默认 `http://localhost:8787`，生产请在 Dashboard 设为真实域名 |
| `GRAVATAR_MIRROR` | Gravatar 镜像基址（到 hash 之前），默认 `https://www.gravatar.com/avatar`；可换自建镜像，如 `https://cravatar.cn/avatar` |

本地开发可写入 `.dev.vars`（gitignored）覆盖上述默认值。

### 密钥（本地 `.dev.vars`，生产 `wrangler secret put`）

| 变量 | 说明 |
| --- | --- |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth；未配置时登录页自动隐藏 GitHub 按钮 |
| `MAILER_DRIVER` | `console`（默认，登录链接打印到 wrangler 日志）或 `smtp`（SMTP 直发，经 workerd TCP socket） |
| `SMTP_HOST` / `SMTP_PORT` | `MAILER_DRIVER=smtp` 时必填；生产请用 465 或 587（Workers 禁止 25 端口出站） |
| `SMTP_SECURE` | `tls`（隐式，默认 465）/ `starttls`（默认非 465 端口时用）/ `none`（本地明文测试） |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP AUTH（PLAIN/LOGIN）；免认证服务器可留空 |
| `SMTP_FROM` | 发件地址；缺省用 `SMTP_USER` |
| `ADMIN_EMAILS` | 逗号分隔的管理员引导邮箱，命中即提升为管理员 |

### 部署

推荐直接点击上方的 **Deploy to Cloudflare** 按钮：它会 fork 本仓库、自动创建 D1 与 KV（Wrangler 的 Automatic provisioning，无需手填资源 ID），并以 `env.production` 部署名为 `earthol-player-profile-production` 的 Worker。

一键部署后还需完成两步：

1. **初始化数据库（必须，且只做一次）。** 自动创建的是空库，需手动应用 `schema.sql`。先查到自动创建的库名（带 Worker 名前缀），再执行：

   ```bash
   wrangler d1 list
   wrangler d1 execute <上面查到的库名> --remote --file=./schema.sql
   ```

   > 自动创建的资源 ID 只存在于 Cloudflare Dashboard，不会写回仓库。

2. **配置生产变量与密钥。** 在 Dashboard 的 **Settings → Variables & Secrets** 中设置：
   - 明文：`APP_URL`（真实域名）、`GRAVATAR_MIRROR`（可选）
   - 密钥：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`（可选）、`MAILER_DRIVER` + `SMTP_*`（可选）、`ADMIN_EMAILS`（建议）

   > `wrangler.jsonc` 已设置 `keep_vars: true` 且不声明任何 `vars`，因此 Dashboard 里设置的环境变量（含 `APP_URL` / `GRAVATAR_MIRROR`）不会再被每次部署重置。

   密钥也可用 `wrangler secret put --env production <名称>` 写入，例如：

   ```bash
   wrangler secret put GITHUB_CLIENT_SECRET --env production
   wrangler secret put ADMIN_EMAILS --env production
   ```

3. **验证。** 访问 `/health` 确认存活。公开部署前建议先设置 `ADMIN_EMAILS`，否则**第一个注册的用户会自动成为管理员**。

> 本地开发：`wrangler dev` 会自动创建本地 D1/KV（无需 ID），首次需先执行 `npm run db:init` 建表。

## 项目结构

```
src/
  index.ts          # Worker 入口
  app.tsx           # 组装路由与全局中间件（locale → user → runtime → csrf）
  routes/           # health / api / language / auth / onboarding / dashboard / admin / public
  middleware/       # auth（loadUser、requireAdmin）、locale、runtime（设置 + 维护模式）
  views/            # SSR 页面组件（layout、login、dashboard、admin、profile 等）
  lib/              # 会话、CSRF、邮件、限流、OAuth、账号关联、缓存、设置、主题、标签、Gravatar、MFM
  db/               # D1 查询与行类型
  i18n/             # en.ts 为词条源，zh.ts 类型上强制对齐
  styles/app.css    # Tailwind v4 入口（设计令牌 + 组件类 + 移动端抽屉样式）
schema.sql          # 全量 D1 建表与种子语句（`npm run db:init` 应用）
public/             # 静态资源；styles.css 为构建产物
```

## 贡献

如果你发现任何问题，欢迎提交Issue或PR！
