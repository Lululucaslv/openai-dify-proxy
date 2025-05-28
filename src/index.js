import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Dify 配置
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;
if (!DIFY_API_KEY) {
  console.error('请在 .env 文件中设置 DIFY_API_KEY');
  process.exit(1);
}

app.use(express.json());

// 核心处理逻辑，兼容 SSE 和普通模式
async function handleCompletion(req, res) {
  try {
    const { model, messages, stream, ...rest } = req.body;
    // 把所有用户消息按行拼成一个 query
    const query = (messages || []).map(m => m.content).join('\n');
    const body = {
      query,
      inputs: {},                            // 如有自定义变量，可填在这里
      user: rest.user || 'anonymous',
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

    // SSE 流式返回
    if (stream) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      return upstream.body.pipe(res);
    }

    // 非流式返回 JSON
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// 原路径：OpenAI 兼容接口
app.post('/v1/chat/completions', handleCompletion);

// 兼容不带版本号的路径（Page Assist 默认发到 /chat/completions）
app.post('/chat/completions', handleCompletion);

app.listen(PORT, () => {
  console.log(`Proxy 服务已启动，端口 ${PORT}`);
});