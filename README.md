# 每日天气邮件简报

一个使用 Node.js 的天气邮件脚本：从和风天气获取未来 7 天天气和当天生活指数，通过 OpenAI 兼容接口生成中文 HTML 简报，再通过 SMTP 发送到指定邮箱。可以本地执行，也可以使用仓库内的 GitHub Actions 定时运行。

## 项目功能与结构

- 提供今天、明天、后天的穿衣、降雨、防晒等生活建议。
- 用表格展示未来 7 天的天气、温度、风力及降水信息。
- 支持中文城市名或和风天气 LocationID；每次执行为一个城市发送一封邮件。
- 工作流计划在北京时间／香港时间每天 07:30 运行，也支持手动触发。

| 文件 | 用途 |
| --- | --- |
| `index.js` | 解析城市、获取天气、生成 HTML、发送邮件 |
| `package.json` | ES Module 配置和 `nodemailer` 依赖 |
| `.github/workflows/weather.yml` | GitHub Actions 定时与手动运行配置 |

## 开始前准备

1. 准备 Node.js 和 npm；现有工作流使用 Node.js 20，本地可使用相同版本复现。
2. 在和风天气准备 API Key、账号专属 API Host，以及目标城市的 LocationID，并确认账号可以访问 7 天天气和生活指数接口。
3. 准备支持 `/chat/completions` 的 OpenAI 兼容服务地址、API Key 和可用模型名。
4. 准备已开启 SMTP 服务的发件邮箱、SMTP 服务器地址、端口和授权码／凭据。

### 和风天气地址的兼容性

当前代码默认使用旧地址 `devapi.qweather.com`，中文城市查询还固定使用 `geoapi.qweather.com`。和风天气已说明旧公共地址从 2026 年起逐步停止服务，因此新配置应使用账号专属 API Host。参见[和风天气 API Host 文档](https://dev.qweather.com/docs/configuration/api-host/)。

- 本地运行时，显式设置 `QWEATHER_HOST`，只填域名，不加 `https://` 或路径。
- 使用数字 LocationID 可以跳过旧的城市查询接口；此时邮件中的城市名称会显示为该 ID。
- 当前工作流没有传入 `QWEATHER_HOST`。使用 GitHub Actions 前，需要按下文补上这一项；仅创建同名 Secret 不会自动传入脚本。

## 配置项

脚本从环境变量读取配置。下面的默认值仅在变量**未定义**时生效，变量存在但为空字符串时不会生效（`EMAIL_TO` 除外）。

| 变量 | 说明 | 本地未定义时的默认值 |
| --- | --- | --- |
| `QWEATHER_KEY` | 和风天气 API Key，必填 | 无 |
| `QWEATHER_HOST` | 账号专属 API 域名，应显式设置 | `devapi.qweather.com`（旧地址） |
| `CITY` | 中文城市名或数字 LocationID，建议使用 ID | `101010100`（北京） |
| `OPENAI_API_KEY` | OpenAI 兼容服务的 API Key，必填 | 无 |
| `OPENAI_BASE_URL` | 接口根地址；脚本会追加 `/chat/completions` | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 服务支持且账号可用的模型名 | `gpt-4o-mini` |
| `SMTP_HOST` | 邮箱服务商的 SMTP 地址 | `smtp.qq.com` |
| `SMTP_PORT` | SMTP 端口；`465` 时启用隐式 TLS | `465` |
| `SMTP_USER` | 发件邮箱账号，必填 | 无 |
| `SMTP_PASS` | SMTP 授权码或服务商要求的凭据，必填 | 无 |
| `EMAIL_TO` | 收件邮箱 | 未设置或为空时发给 `SMTP_USER` |

模型和接口地址的默认值来自当前代码，并不保证你的服务账号具备对应权限。

## 本地设置与运行

克隆项目并安装依赖：

```bash
git clone https://github.com/Chen2226/daily-weather-briefing.git
cd daily-weather-briefing
npm install
```

在同一个终端设置环境变量。以下是 macOS／Linux 的 Bash 或 Zsh 示例；执行前替换占位内容，并按邮箱服务商要求调整 SMTP 配置：

```bash
export QWEATHER_KEY='你的和风天气 API Key'
export QWEATHER_HOST='你的账号专属 API 域名'
export CITY='101010100'
export OPENAI_API_KEY='你的 AI 服务 API Key'
export OPENAI_BASE_URL='https://api.openai.com/v1'
export OPENAI_MODEL='你的可用模型名'
export SMTP_HOST='smtp.qq.com'
export SMTP_PORT='465'
export SMTP_USER='你的发件邮箱'
export SMTP_PASS='你的 SMTP 授权码'
export EMAIL_TO='你的收件邮箱'

node index.js
```

脚本会依次输出解析城市、获取天气、生成简报和发送邮件的日志。看到“邮件已成功发送”后，检查收件箱和垃圾邮件目录。每次运行都会实际调用外部服务并尝试发送邮件。

脚本不会自动读取 `.env`，项目也未定义 `npm start`。请使用上面的环境变量和 `node index.js`。不要把真实密钥写入代码或提交到仓库；当前 `.gitignore` 也没有忽略 `.env`。

## GitHub Actions 设置

### 1. 配置仓库 Secrets

打开自己的仓库，在 **Settings → Secrets and variables → Actions → New repository secret** 中逐项添加配置。操作说明见 [GitHub Secrets 文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

现有工作流会显式注入环境变量，未配置的 Secret 会变成空字符串，因此请为以下各项都填写非空值：

```text
QWEATHER_KEY
CITY
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
```

`EMAIL_TO` 可以不设置，此时邮件发给发件人自己。这里应创建 **Secrets**；现有工作流读取的是 `secrets.*`，不是 `vars.*`。

### 2. 传入专属天气 API Host

再创建 `QWEATHER_HOST` Secret，值为账号专属域名。在 `.github/workflows/weather.yml` 的“运行脚本发送邮件”步骤中，在现有 `env:` 下添加如下配置，并与 `QWEATHER_KEY` 保持相同缩进：

```yaml
          QWEATHER_HOST: ${{ secrets.QWEATHER_HOST }}
```

提交这一配置修改，并将 `CITY` 设置为数字 LocationID，以避开当前固定使用旧域名的城市查询接口。本 README 记录的是现有实现及设置步骤，仓库内工作流尚未包含上述新增行。

### 3. 手动验证

在 GitHub 仓库的 **Actions** 页面启用工作流（如有提示），选择“每日7天天气邮件推送”，点击 **Run workflow**，选择已配置的分支并运行。工作流文件需要存在于默认分支，手动运行入口才可用。参见 [GitHub 手动运行工作流文档](https://docs.github.com/en/actions/managing-workflow-runs/manually-running-a-workflow)。

打开运行记录，检查“运行脚本发送邮件”步骤的日志，并确认邮箱实际收到简报。

### 4. 调整发送时间

当前定时表达式为：

```yaml
schedule:
  - cron: '30 23 * * *'
```

该配置采用 UTC，对应北京时间／香港时间次日 07:30。例如希望每天 08:00 运行，可改为 `'0 0 * * *'`。定时执行受 GitHub 调度影响，不应视作精确到点送达的保证。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 无法找到城市 | 检查 `CITY` 是否为空；中文查询使用旧域名，优先使用数字 LocationID |
| 获取 7 天天气失败 | 检查 API Key、专属 Host、城市 ID 及接口权限；Actions 还需确认已传入 `QWEATHER_HOST` |
| 本地正常，Actions 报错 | 检查前述必填 Secrets；空字符串不会启用 JavaScript 解构默认值 |
| AI 接口报错或地址无效 | 检查 Key、账号权限、模型名和根地址；不要重复填写 `/chat/completions` |
| SMTP 登录失败或连接失败 | 检查邮箱是否开启 SMTP、授权码及服务器端口；`465` 使用隐式 TLS，其他端口按服务商要求配置 |
| 日志显示发送成功但未收信 | 检查 `EMAIL_TO`、垃圾邮件目录及服务商投递情况；SMTP 接受邮件不等于一定进入收件箱 |
| 生活指数未显示 | 当前代码在指数接口返回非成功业务码时使用空列表，简报仍可基于天气预报生成 |

项目没有独立测试命令。只检查 JavaScript 语法、不调用外部服务时，可以运行 `node --check index.js`；完整验证需要有效配置并实际执行一次邮件发送。
