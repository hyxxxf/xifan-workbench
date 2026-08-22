/**
 * 本地 CORS 代理（HTTP 版，专为「希凡工作台」设计）
 * 作用：让纯前端网页绕过浏览器对大模型接口的跨域(CORS)限制。
 *
 * 为什么用 HTTP 而不是 HTTPS？
 *   - 网页托管在 GitHub Pages(HTTPS)，但浏览器把 127.0.0.1 / localhost
 *     视为「安全上下文」，HTTPS 页面调用 http://127.0.0.1 不触发混合内容拦截，
 *     因此无需自签名证书，也不会出现「不安全」警告。
 *
 * 数据流：
 *   浏览器(HTTPS 页面) ─HTTP─> 本机 127.0.0.1:3000(此代理) ─服务端转发─> 真实大模型 API(HTTPS)
 *
 * 仅监听 127.0.0.1（本机回环），不对外暴露，安全。
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const START_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 10;
const DEFAULT_UPSTREAM = (process.env.UPSTREAM || '').replace(/\/$/, '');
let actualPort = START_PORT;
const START_AT = Date.now();

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = http.createServer()
      .once('error', (err) => resolve(err.code === 'EADDRINUSE'))
      .once('listening', () => { tester.close(); resolve(false); })
      .listen(port, '127.0.0.1');
  });
}

async function findPort() {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const p = START_PORT + i;
    if (!(await isPortInUse(p))) return p;
    console.log('端口 ' + p + ' 被占用，尝试 ' + (p + 1) + ' …');
  }
  return null;
}

function handleRequest(req, res) {
  // 始终回 CORS 头，允许任意来源（仅本机可访问，无安全风险）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-upstream');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // 健康检查：供网页自动发现代理端口
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      proxy: 'math-grader-local-cors-proxy',
      port: actualPort,
      startAt: START_AT,
      https: false
    }));
  }

  // 真实上游地址通过 x-upstream 请求头传入（如 https://token.sensenova.cn/v1）
  const upstream = (req.headers['x-upstream'] || DEFAULT_UPSTREAM).replace(/\/$/, '');
  if (!upstream) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('缺少 x-upstream 请求头');
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? Buffer.concat(chunks) : null;
    let target;
    try { target = new URL(upstream.replace(/\/$/, '') + req.url); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('上游地址解析失败: ' + e.message);
    }

    const options = { method: req.method, headers: { ...req.headers, host: target.host } };
    delete options.headers['x-upstream'];
    delete options.headers['access-control-request-headers'];
    delete options.headers['access-control-request-method'];
    delete options.headers['origin'];
    delete options.headers['referer'];
    delete options.headers['connection'];

    const TIMEOUT_MS = 300000; // 大模型推理可能较慢
    const proto = target.protocol === 'http:' ? http : https;
    const p = proto.request(target, options);
    p.setTimeout(TIMEOUT_MS);
    p.on('response', (upRes) => {
      upRes.setTimeout(TIMEOUT_MS);
      upRes.on('timeout', () => {
        upRes.destroy();
        if (!res.headersSent) { res.writeHead(504); res.end('上游响应超时'); }
      });
      const hopByHop = new Set([
        'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
        'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-encoding', 'content-length'
      ]);
      const outHeaders = { 'access-control-allow-origin': '*' };
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!hopByHop.has(k.toLowerCase())) outHeaders[k] = v;
      }
      outHeaders['content-encoding'] = 'identity';
      res.writeHead(upRes.statusCode, outHeaders);
      upRes.pipe(res);
    });
    p.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502);
      res.end('代理转发失败: ' + e.message);
    });
    p.on('timeout', () => {
      p.destroy();
      if (!res.headersSent) { res.writeHead(504); res.end('上游请求超时'); }
    });
    if (body) p.write(body);
    p.end();
  });
}

(async () => {
  const port = await findPort();
  if (!port) {
    console.error('端口 ' + START_PORT + '~' + (START_PORT + MAX_PORT_ATTEMPTS - 1) + ' 均被占用');
    process.exit(1);
  }
  actualPort = port;
  const server = http.createServer(handleRequest);
  server.listen(actualPort, '127.0.0.1', () => {
    console.log('本地 CORS 代理已启动: http://127.0.0.1:' + actualPort);
  });
  server.on('error', (err) => {
    console.error('代理启动失败:', err.message);
    process.exit(1);
  });
})();
