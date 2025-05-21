import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 你的 Dify API 地址和 Key
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

if (!DIFY_API_KEY) {
  console.error('请在 .env 文件中设置 DIFY_API_KEY');
  process.exit(1);
}

app.use(express.json());

// 代理 OpenAI SDK 的 POST /chat/completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    // 构造 Dify 的 body
    const { model, messages, stream, ...rest } = req.body;

    // Dify chat-messages 接口只接受 query+inputs+user+response_mode
    const query = messages.map(m => m.content).join('\n');
    const body = {
      query,
      inputs: {},                // 如果你有自定义变量，写在这里
      user: rest.user || 'anonymous',
      response_mode: stream ? 'streaming' : 'standard'
    };

    // 发起到 Dify 的请求
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
      res.status(upstream.status).send(text);
      return;
    }

    // 设置 SSE 相关头
    if (stream) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      upstream.body.pipe(res);
    } else {
      const data = await upstream.json();
      // Dify 返回的最后回答在 data.outputs.answer 或 data.outputs.text
      res.json({
        id: data.message_id,
        object: 'chat.completion',
        created: data.created_at,
        model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: data.outputs.answer || data.outputs.text
          },
          finish_reason: 'stop'
        }]
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy 服务已启动，端口 ${PORT}`);
});