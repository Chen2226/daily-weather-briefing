import nodemailer from 'nodemailer';

// 1. 读取环境变量配置
const {
  QWEATHER_KEY,                          // 必填：和风天气 API Key
  QWEATHER_HOST,                        // 必填：和风天气账号专属 API Host
  CITY = '101010100',                    // 支持中文城市名或 LocationID，多个城市用英文逗号分隔
  OPENAI_API_KEY,                        // 必填：OpenAI 兼容接口密钥
  OPENAI_BASE_URL = 'https://api.openai.com/v1', // 选填：接口地址
  OPENAI_MODEL = 'gpt-4o-mini',          // 选填：模型名称，多个模型用英文逗号分隔

  // 邮件配置
  SMTP_HOST = 'smtp.qq.com',             // 必填：SMTP 服务器地址 (如 smtp.qq.com 或 smtp.163.com)
  SMTP_PORT = '465',                     // 选填：SSL 端口默认 465
  SMTP_USER,                             // 必填：发件人邮箱账号 (如 123456@qq.com)
  SMTP_PASS,                             // 必填：发件人邮箱 SMTP 授权码
  EMAIL_TO                               // 选填：收件人邮箱（如果不填，默认发给发件人自己）
} = process.env;

/**
 * 辅助函数：通过城市名或 LocationID 查询城市名称和 ID
 */
async function getLocationId(cityInput) {
  const geoUrl = `https://${QWEATHER_HOST}/geo/v2/city/lookup?location=${encodeURIComponent(cityInput)}&key=${QWEATHER_KEY}`;
  const res = await fetch(geoUrl);
  const data = await res.json();
  if (data.code !== '200' || !data.location?.length) {
    throw new Error(`无法找到城市 [${cityInput}]，和风返回: ${JSON.stringify(data)}`);
  }
  const loc = data.location[0];
  return { id: loc.id, name: `${loc.adm1}·${loc.name}` };
}

/**
 * 步骤 1：获取和风天气未来 7 天预报、逐小时预报和当天生活指数
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

  let hourly = [];
  let hourlyUpdateTime = '';
  try {
    const hourlyUrl = `https://${QWEATHER_HOST}/v7/weather/24h?location=${locationId}&key=${QWEATHER_KEY}`;
    const hourlyRes = await fetch(hourlyUrl, { signal: AbortSignal.timeout(15_000) });
    const hourlyData = await hourlyRes.json();
    if (!hourlyRes.ok || hourlyData.code !== '200' || !Array.isArray(hourlyData.hourly)) {
      throw new Error(`HTTP ${hourlyRes.status}，业务码 ${hourlyData.code}`);
    }
    // fxTime 自带城市当地时区；按预报日期筛选，不按运行机器的 UTC 日期筛选。
    hourly = hourlyData.hourly.filter(h => h.fxTime?.slice(0, 10) === weatherData.daily[0].fxDate);
    hourlyUpdateTime = hourlyData.updateTime || '';
  } catch (err) {
    console.warn(`⚠️ 逐小时预报不可用，将仅提供每日天气建议: ${err.message}`);
  }

  return {
    hourly,
    hourlyUpdateTime,
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

  const hourlyText = weather.hourly.map(h =>
    `${h.fxTime}: ${h.text ?? '暂无天气现象'}, 气温 ${h.temp ?? '未知'}°C, ` +
    `降水概率 ${h.pop ?? '未知'}%, 降水量 ${h.precip ?? '未知'}mm, ` +
    `${h.windDir ?? '未知风向'} ${h.windScale ?? '未知'}级`
  ).join('\n');

  const prompt = `你是一位贴心的私人气象生活助理。以下是【${cityName}】未来 7 天的气象数据及今日生活指数：

### 未来7天预报数据：
${dailyText}

### 今日生活指数参考：
${indicesText || '暂无'}

### 今天（${weather.daily[0].fxDate}）剩余时段逐小时预报（时间为城市当地时间，保留时区）：
更新时间：${weather.hourlyUpdateTime || '未知'}
${hourlyText || '暂无逐小时数据，无法判断具体降雨时段'}

请你直接输出一段**纯 HTML 代码**（不要用 \`\`\`html 包裹，直接以 <div> 开头），用于作为每日天气邮件的正文。
要求采用现代、清爽的卡片式内联 CSS 样式（适配手机和电脑阅读），严格包含以下三部分内容：

1. **🕒 今天分时天气与降雨提醒**
   - 优先总结预计有雨的时段，用“预计 HH:mm–HH:mm 有雨”等措辞，并列出对应降水概率范围、雨量及出行建议；单个小时点写“HH:mm 前后可能有雨”，不要凭空扩展起止时间。
   - 只能合并时间相邻、相隔恰好一小时且均有降雨依据的预报点；不要跨越无雨时段或数据缺口。依据天气现象区分雨、雪和雨夹雪，不能将所有降水都写成下雨。
   - 若仅有降水概率而天气现象未报雨，表述为“有降水可能”，不可断言有雨。概率缺失写“未提供”，不能当成 0%。没有降雨依据时只说“已覆盖时段暂无明显降雨信号”，不可保证全天无雨。
   - 用紧凑表格列出已提供的逐小时数据：时间、天气、气温、降水概率、降水量和风力，并总结通勤、午间、傍晚的变化（仅限数据覆盖时段）。
   - 标明数据覆盖的起止时刻、预报更新时间及“城市当地时间”；仅分析今天，不能把明天凌晨的数据算作今天，也不能补写过去或未覆盖时段的天气。
   - 逐小时数据缺失时，明确写“逐小时预报暂不可用，无法判断具体降雨时段”，只给每日层面的建议，不得从日预报猜测几点下雨。
   - 提醒这是小时级预报，降雨起止可能变化，不代表分钟级精确预报；不得虚构任何数值。

2. **💡 今/明/后三天重点注意事项（高亮提示卡片）**
   - 分别针对**今天**、**明天**、**后天**给出具体且生活化的建议（用不同颜色的标签或列表区分）。
   - 重点结合：降雨带伞提醒、温度骤变/昼夜温差穿衣建议、紫外线防晒、大风或易感冒提醒。语气温暖精炼。

3. **📅 未来 7 天天气一览（精美表格）**
   - 使用 HTML <table> 展示未来 7 天：日期（推算并标出星期几，今明后可高亮）、天气现象（配上合适的 Emoji 如 ☀️🌧️⛅）、最低~最高温度、风力与降水简况。`;

  const baseUrl = OPENAI_BASE_URL.replace(/\/+$/, '');
  const models = OPENAI_MODEL.split(',').map(model => model.trim()).filter(Boolean);
  if (!models.length) {
    throw new Error('OPENAI_MODEL 至少需要配置一个模型');
  }

  for (const model of models) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一个擅长编写精美 HTML 邮件的气象生活顾问。只输出纯净的 HTML 代码片段，不要包含 markdown 代码块标记。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('模型未返回文本内容');
      }
      // 清理可能残留的 ```html 标记
      const html = content.trim().replace(/^```html\s*/i, '').replace(/```$/i, '').trim();
      if (!html) {
        throw new Error('模型返回内容为空');
      }
      return html;
    } catch (err) {
      console.warn(`⚠️ 模型 ${model} 调用失败: ${err.message}`);
    }
  }
  throw new Error(`所有 AI 模型均调用失败: ${models.join(', ')}`);
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
  if (!QWEATHER_HOST?.trim()) {
    throw new Error('请设置 QWEATHER_HOST 为和风天气账号专属 API 域名');
  }
  const cities = CITY.split(',').map(city => city.trim()).filter(Boolean);
  if (!cities.length) {
    throw new Error('CITY 至少需要配置一个城市');
  }

  for (const city of cities) {
    console.log('⏳ 1. 正在解析城市信息...');
    const location = await getLocationId(city);
    console.log(`✅ 目标城市: ${location.name} (${location.id})`);

    console.log('⏳ 2. 正在拉取和风天气 7 天及逐小时数据...');
    const weather = await getWeatherData(location.id);

    console.log('⏳ 3. 正在请求 AI 生成今明后注意事项与 HTML 邮件...');
    const htmlReport = await generateHtmlEmail(location.name, weather);

    const today = weather.daily[0];
    const subject = `🌤️ [${location.name}] 今日${today.textDay} ${today.tempMin}~${today.tempMax}°C | 近7天天气与出行提醒`;

    console.log('⏳ 4. 正在发送邮件...');
    const cityHeading = location.name.replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    await sendEmail(subject, `<h2>${cityHeading}天气简报</h2>${htmlReport}`);
  }
  console.log('🎉 全部任务执行完毕！');
}

main().catch(err => {
  console.error('❌ 执行出错:', err);
  process.exit(1);
});