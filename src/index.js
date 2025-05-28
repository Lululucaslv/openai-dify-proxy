import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// 从环境变量读取
const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL;
const PORT = Number(process.env.PORT) || 3000;

// 校验
if (!DIFY_API_KEY) {
  console.error('❌ 请在 .env 文件中设置 DIFY_API_KEY');
  process.exit(1);
}
if (!DIFY_API_URL) {
  console.error('❌ 请在 .env 文件中设置 DIFY_API_URL');
  process.exit(1);
}

const app = express();
app.use(express.json());

// 处理逻辑
async function handleCompletion(req, res) {
  try {
    const { model, messages = [], stream, user, ...rest } = req.body;
    // 把 messages 拼为一个 query
    const query = messages.map(m => m.content).join('\n');

    const body = {
      query,
      inputs: {},                        // 如有自定义变量可填在这里
      user: user || rest.user || 'anonymous',
      response_mode: stream ? 'streaming' : 'standard'
    };

    const upstream = await fetch(DIFY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }

    // 流式返回 (SSE)
    if (stream) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      return upstream.body.pipe(res);
    }

    // 普通 JSON 返回
    const data = await upstream.json();
    const answer = data.outputs.answer ?? data.outputs.text ?? '';
    res.json({
      id: data.message_id,
      object: 'chat.completion',
      created: data.created_at,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: answer },
        finish_reason: 'stop'
      }]
    });

  } catch (err) {
    console.error('❌ Error in proxy:', err);
    res.status(500).json({ error: err.message });
  }
}

// 两个路由都指向同一处理函数
app.post('/v1/chat/completions', handleCompletion);
app.post('/chat/completions', handleCompletion);

app.listen(PORT, () => {
  console.log(`✅ Proxy 服务已启动，端口 ${PORT}`);
});