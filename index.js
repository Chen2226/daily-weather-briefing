import nodemailer from 'nodemailer';

// 1. 读取环境变量配置
const {
  QWEATHER_KEY,                          // 必填：和风天气 API Key
  QWEATHER_HOST = 'devapi.qweather.com', // 选填：免费版默认 devapi.qweather.com
  CITY = '101010100',                    // 必填：支持中文城市名（如 "杭州"）或 LocationID
  OPENAI_API_KEY,                        // 必填：OpenAI 兼容接口密钥
  OPENAI_BASE_URL = 'https://api.openai.com/v1', // 选填：接口地址
  OPENAI_MODEL = 'gpt-4o-mini',          // 选填：模型名称

  // 邮件配置
  SMTP_HOST = 'smtp.qq.com',             // 必填：SMTP 服务器地址 (如 smtp.qq.com 或 smtp.163.com)
  SMTP_PORT = '465',                     // 选填：SSL 端口默认 465
  SMTP_USER,                             // 必填：发件人邮箱账号 (如 123456@qq.com)
  SMTP_PASS,                             // 必填：发件人邮箱 SMTP 授权码
  EMAIL_TO                               // 选填：收件人邮箱（如果不填，默认发给发件人自己）
} = process.env;

/**
 * 辅助函数：支持直接填中文城市名，自动转为和风 LocationID
 */
async function getLocationId(cityInput) {
  if (/^\d+$/.test(cityInput)) {
    return { id: cityInput, name: cityInput };
  }
  const geoUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(cityInput)}&key=${QWEATHER_KEY}`;
  const res = await fetch(geoUrl);
  const data = await res.json();
  if (data.code !== '200' || !data.location?.length) {
    throw new Error(`无法找到城市 [${cityInput}]，和风返回: ${JSON.stringify(data)}`);
  }
  const loc = data.location[0];
  return { id: loc.id, name: `${loc.adm1}·${loc.name}` };
}

/**
 * 步骤 1：获取和风天气未来 7 天预报 + 当天生活指数
 */
async function getWeatherData(locationId) {
  const weatherUrl = `https://${QWEATHER_HOST}/v7/weather/7d?location=${locationId}&key=${QWEATHER_KEY}`;
  const weatherRes = await fetch(weatherUrl);
  const weatherData = await weatherRes.json();

  if (weatherData.code !== '200') {
    throw new Error(`获取7天天气失败: ${JSON.stringify(weatherData)}`);
  }

  // 获取当天生活指数 (1:运动, 3:穿衣, 5:紫外线, 9:感冒)
  const indicesUrl = `https://${QWEATHER_HOST}/v7/indices/1d?type=1,3,5,9&location=${locationId}&key=${QWEATHER_KEY}`;
  const indicesRes = await fetch(indicesUrl);
  const indicesData = await indicesRes.json();

  return {
    daily: weatherData.daily,
    indices: indicesData.code === '200' ? indicesData.daily : []
  };
}

/**
 * 步骤 2：调用 AI 生成排版精美的 HTML 邮件正文
 */
async function generateHtmlEmail(cityName, weather) {
  const dailyText = weather.daily.map((d, idx) => {
    const label = idx === 0 ? '【今天】' : idx === 1 ? '【明天】' : idx === 2 ? '【后天】' : `【第${idx + 1}天】`;
    return `${label} ${d.fxDate}: 白天${d.textDay}/夜间${d.textNight}, 气温 ${d.tempMin}°C ~ ${d.tempMax}°C, ` +
           `${d.windDirDay}${d.windScaleDay}级, 降水量 ${d.precip}mm, 紫外线 ${d.uvIndex}, 湿度 ${d.humidity}%`;
  }).join('\n');

  const indicesText = weather.indices.map(i => `${i.name}(${i.category}): ${i.text}`).join('\n');

  const prompt = `你是一位贴心的私人气象生活助理。以下是【${cityName}】未来 7 天的气象数据及今日生活指数：

### 未来7天预报数据：
${dailyText}

### 今日生活指数参考：
${indicesText || '暂无'}

请你直接输出一段**纯 HTML 代码**（不要用 \`\`\`html 包裹，直接以 <div> 开头），用于作为每日天气邮件的正文。
要求采用现代、清爽的卡片式内联 CSS 样式（适配手机和电脑阅读），严格包含以下两部分内容：

1. **💡 今/明/后三天重点注意事项（高亮提示卡片）**
   - 分别针对**今天**、**明天**、**后天**给出具体且生活化的建议（用不同颜色的标签或列表区分）。
   - 重点结合：降雨带伞提醒、温度骤变/昼夜温差穿衣建议、紫外线防晒、大风或易感冒提醒。语气温暖精炼。

2. **📅 未来 7 天天气一览（精美表格）**
   - 使用 HTML <table> 展示未来 7 天：日期（推算并标出星期几，今明后可高亮）、天气现象（配上合适的 Emoji 如 ☀️🌧️⛅）、最低~最高温度、风力与降水简况。`;

  const baseUrl = OPENAI_BASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: '你是一个擅长编写精美 HTML 邮件的气象生活顾问。只输出纯净的 HTML 代码片段，不要包含 markdown 代码块标记。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI 接口调用失败 (${response.status}): ${errText}`);
  }

  const result = await response.json();
  let html = result.choices[0].message.content.trim();
  // 清理可能残留的 ```html 标记
  html = html.replace(/^```html\s*/i, '').replace(/```$/i, '');
  return html;
}

/**
 * 步骤 3：通过 SMTP 发送 HTML 邮件
 */
async function sendEmail(subject, htmlContent) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // 465 端口开启 SSL
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const receiver = EMAIL_TO || SMTP_USER; // 默认发给自己
  const info = await transporter.sendMail({
    from: `"🌤️ 每日天气助理" <${SMTP_USER}>`,
    to: receiver,
    subject: subject,
    html: htmlContent
  });

  console.log(`✅ 邮件已成功发送至 ${receiver} (MessageId: ${info.messageId})`);
}

/**
 * 主流程
 */
async function main() {
  console.log('⏳ 1. 正在解析城市信息...');
  const location = await getLocationId(CITY);
  console.log(`✅ 目标城市: ${location.name} (${location.id})`);

  console.log('⏳ 2. 正在拉取和风天气 7 天数据...');
  const weather = await getWeatherData(location.id);

  console.log('⏳ 3. 正在请求 AI 生成今明后注意事项与 HTML 邮件...');
  const htmlReport = await generateHtmlEmail(location.name, weather);

  const today = weather.daily[0];
  const subject = `🌤️ [${location.name}] 今日${today.textDay} ${today.tempMin}~${today.tempMax}°C | 近7天天气与出行提醒`;

  console.log('⏳ 4. 正在发送邮件...');
  await sendEmail(subject, htmlReport);
  console.log('🎉 全部任务执行完毕！');
}

main().catch(err => {
  console.error('❌ 执行出错:', err);
  process.exit(1);
});