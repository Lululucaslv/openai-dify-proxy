// src/index.js
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const DIFY_KEY = process.env.DIFY_API_KEY;
if (!DIFY_KEY) {
  console.error('请设置 DIFY_API_KEY');
  process.exit(1);
}

app.post('/v1/chat/completions', async (req, res) => {
  // 1. 转发给 Dify，开启 SSE
  const upstream = await fetch('https://api.dify.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DIFY_KEY}`,
    },
    body: JSON.stringify({ ...req.body, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  }

  // 2. 设置响应头为 SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.flushHeaders();

  // 3. 逐行读取 Dify 的 SSE，转换后写给客户端
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let lines = buf.split(/\r?\n/);
    buf = lines.pop() || ''; // 最后一行可能不完整，留给下次

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith('data:')) continue;

      const jsonStr = line.slice(5).trim();
      if (jsonStr === '[DONE]') {
        // Dify 结束标记（如果有）
        res.write(`data: [DONE]\n\n`);
        break;
      }

      let evt;
      try {
        evt = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      // 根据 Dify 的 payload 构造 OpenAI 的 delta
      // Dify 每次 event.data.data.answer 里可能就是文本片段
      const text = evt.data?.answer ?? '';
      const delta = text ? { content: text } : {};

      const chunk = {
        choices: [{
          delta,
          index: 0,
          finish_reason: null
        }]
      };

      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  }

  // 4. 最后给一个 DONE
  res.write('data: [DONE]\n\n');
  res.end();
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Proxy 服务已启动，端口 ${port}`);
});