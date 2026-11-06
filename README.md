# 每日天气邮件简报

自动获取未来 7 天天气及今天的逐小时预报，用 AI 生成降雨时段、通勤提醒和今明后三天的生活建议，再通过邮箱发送。支持 GitHub Actions 每天定时运行，无需自备服务器。

今天的简报包含逐小时气温、降水概率、雨量和风力，并总结预计有雨的时间段。时间以城市当地时间为准，仅覆盖接口提供的今天剩余时段；小时级预报不能精确到分钟。若逐小时接口不可用，会保留每日简报并明确提示，不猜测降雨时间。

每日和逐小时预报分别使用 `/weather/v1/daily/{latitude}/{longitude}` 和 `/weather/v1/hourly/{latitude}/{longitude}`，自动从城市查询结果获取经纬度，读取未来 7 天及 24 小时天气，无需新增配置。

## 1. 准备配置

- **和风天气**：准备 API Key，在[控制台设置](https://dev.qweather.com/docs/configuration/api-host/)查看账号专属 API Host，只填域名，不加 `https://`。账号需具备城市查询、[7 天天气](https://dev.qweather.com/docs/api/weather/weather-daily-forecast/)和 [24 小时天气预报](https://dev.qweather.com/docs/api/weather/weather-hourly-forecast/)的访问权限。
- **城市 ID**：在 [LocationList 城市列表](https://github.com/qwd/LocationList)中查找，也支持直接填写中文城市名。程序会查询城市名称，并显示在邮件标题和正文中。
- **AI 服务**：准备 OpenAI 兼容接口的地址、API Key 和模型名。
- **邮箱**：开启 SMTP 服务，准备服务器地址、端口和授权码。

## 2. 设置 GitHub Secrets

Fork 或上传项目后，打开仓库 **Settings → Secrets and variables → Actions → New repository secret**，添加以下配置：

| Secret | 填写内容 |
| --- | --- |
| `QWEATHER_KEY` | 和风天气 API Key |
| `QWEATHER_HOST` | 和风天气账号专属 API 域名 |
| `CITY` | 一个或多个城市 ID／中文城市名，用英文逗号分隔，例如 `101010100,101020100` |
| `OPENAI_API_KEY` | AI 服务 API Key |
| `OPENAI_BASE_URL` | 接口根地址，例如 `https://api.openai.com/v1`，不要加 `/chat/completions` |
| `OPENAI_MODEL` | 一个或多个可用模型名，用英文逗号分隔 |
| `SMTP_HOST` | 邮箱 SMTP 地址，例如 `smtp.qq.com` |
| `SMTP_PORT` | 邮箱 SMTP 端口，例如 `465` |
| `SMTP_USER` | 发件邮箱 |
| `SMTP_PASS` | 邮箱 SMTP 授权码或服务商要求的凭据 |
| `EMAIL_TO` | 收件邮箱；不填则发给发件人自己 |

**除 `EMAIL_TO` 外请全部填写**，避免工作流将未设置的 Secret 作为空值传入。密钥只放在 Secrets 中，不要提交到代码。

多个城市示例：

```text
101010100,101020100
```

按配置顺序分别为北京和上海发送邮件，每个城市一封，使用相同的收件人配置。单个城市的写法不变。若某个城市查询、生成或发送失败，本次运行会停止，已发送的邮件不会撤回；重新运行会从第一个城市开始。

多个模型示例：

```text
model-a,model-b,model-c
```

将示例替换为服务商实际支持的模型名。程序按从左到右的顺序尝试，成功后立即使用结果；请求失败、超时（每个模型 60 秒）或返回空内容时切换到下一个，全部失败则结束并报错。所有模型共用同一接口地址和 API Key；只填一个模型也可以。

## 3. 运行

打开仓库 **Actions → 每日7天天气邮件推送 → Run workflow**，手动运行一次，查看日志并检查收件箱。

默认每天北京时间／香港时间 **07:30** 运行。修改 `.github/workflows/weather.yml` 中的 cron 可调整时间：`30 23 * * *` 使用 UTC，对应 UTC+8 的次日 07:30；实际执行可能有调度延迟。

## 本地运行（可选）

准备 Node.js（当前工作流使用 20）及 npm：

```bash
git clone https://github.com/Chen2226/daily-weather-briefing.git
cd daily-weather-briefing
npm install
```

在终端通过 `export 变量名='值'` 设置上表中的环境变量，然后执行：

```bash
node index.js
```

脚本不会自动读取 `.env`。每次运行都会实际调用天气和 AI 服务并尝试发送邮件。

## 常见问题

- **天气获取失败**：检查 API Key、专属 API Host、城市 ID，以及账号的接口权限。
- **所有模型均失败**：检查接口地址、Key 和模型权限，查看日志中的各模型错误。
- **邮件连接超时**：检查 SMTP 地址、端口及运行环境到邮箱服务器的网络连通性；`465` 使用直接 TLS，其他端口按服务商要求设置。
