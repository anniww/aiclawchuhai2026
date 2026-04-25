# AI 落地页全自动生成与部署系统

基于 Cloudflare 生态（Workers + Pages + D1 + KV + AI）构建的一体化 AI 落地页生成与管理系统。

## 🌟 核心功能

- **🤖 AI 智能生成**：基于 Cloudflare Workers AI，一键生成多语言、SEO 优化的落地页
- **🛡️ 安全管理后台**：JWT Token 鉴权、IP 白名单、防暴力破解登录
- **📝 在线代码编辑**：内置代码编辑器，支持实时预览和修改落地页 HTML/CSS
- **⚡ 极速全球分发**：基于 Cloudflare 边缘网络，毫秒级响应
- **🔄 RPA 自动化**：内置 Cron 定时任务，支持自动发布草稿、自动推送 Google 收录
- **📊 数据统计**：内置访问量统计、系统日志审计

## 🏗️ 架构设计

- **前端管理面板**：原生 HTML/JS/CSS，部署于 Cloudflare Pages
- **后端 API**：Cloudflare Workers (Serverless)
- **数据库**：Cloudflare D1 (SQLite)
- **缓存/限流**：Cloudflare KV
- **AI 引擎**：Cloudflare Workers AI (`@cf/meta/llama-3-8b-instruct`)

## 🚀 部署指南

### 1. 准备工作

- 一个 Cloudflare 账号
- 一个 GitHub 账号
- （可选）一个自定义域名

### 2. 数据库与缓存初始化

系统已配置自动初始化功能。在首次部署 Worker 后，只需调用一次初始化接口即可自动创建所有必要的数据表。

### 3. 环境变量配置

在 Cloudflare Workers 的设置中，需要配置以下变量：

**KV 命名空间绑定**：
- 变量名：`KV`
- 绑定到你创建的 KV 命名空间

**D1 数据库绑定**：
- 变量名：`DB`
- 绑定到你创建的 D1 数据库

**环境变量 (Vars)**：
- `JWT_SECRET`：用于生成登录 Token 的随机字符串（建议 32 位以上）
- `ADMIN_PASSWORD_HASH`：管理员密码的 SHA-256 哈希值

### 4. 默认账号

系统初始化后的默认管理员账号：
- **用户名**：`admin`
- **密码**：`Admin@2026`

> ⚠️ **重要提示**：首次登录后，请务必在系统设置中修改默认密码！

## 📖 使用说明

### 1. 登录后台
访问你部署的 Pages 域名（例如 `https://aiclawchuhai2026.pages.dev`），输入管理员账号密码登录。

### 2. AI 生成落地页
1. 在左侧菜单点击"AI 生成"
2. 输入业务名称（如：北京专业律师事务所）
3. 输入核心关键词（如：离婚诉讼, 房产纠纷, 免费咨询）
4. 选择目标语言和国家/城市
5. 点击"开始生成"，系统将调用 AI 自动编写包含 SEO Meta 标签、结构化数据和完整 HTML 结构的落地页。

### 3. 落地页管理
- **编辑**：点击列表中的"编辑"按钮，可在内置的代码编辑器中直接修改 HTML 代码。
- **预览**：点击"预览"按钮可查看实际效果。
- **发布/下线**：只有状态为"已发布"的页面才会被外部访问和包含在 Sitemap 中。
- **访问控制**：可为特定页面设置访问密码或 IP 白名单。

### 4. RPA 自动化任务
系统内置了三个自动化任务：
- **每日自动提交 Google 收录**：自动将 Sitemap 提交给 Google Search Console
- **每日自动发布草稿**：按设定的数量自动将草稿状态的页面转为发布状态
- **死链检测**：定期检查已发布页面中的外部链接是否有效

## 🛠️ 开发与二次定制

### 目录结构

```text
.
├── frontend/               # 前端管理面板代码 (部署到 Pages)
│   ├── index.html          # 主界面 (SPA)
│   ├── _redirects          # Pages 路由规则
│   └── _headers            # Pages 安全头配置
├── worker/                 # 后端 API 代码 (部署到 Workers)
│   ├── src/
│   │   ├── index.js        # 路由入口与系统初始化
│   │   ├── auth.js         # 认证与安全模块
│   │   ├── pages.js        # 落地页 CRUD 模块
│   │   ├── ai.js           # AI 生成模块
│   │   ├── seo.js          # Sitemap 与收录模块
│   │   ├── rpa.js          # 自动化任务模块
│   │   └── utils.js        # 工具函数
│   └── wrangler.toml       # Workers 配置文件
└── deploy.sh               # 一键部署脚本
```

### 本地测试

```bash
# 安装依赖
cd worker
npm install

# 本地运行 Worker
npx wrangler dev
```

## 📄 许可证

MIT License
