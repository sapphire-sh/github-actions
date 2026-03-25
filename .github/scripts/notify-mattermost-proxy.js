#!/usr/bin/env node
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CHANNEL_ID = process.env.MATTERMOST_CHANNEL_ID;
const TOKEN = process.env.MATTERMOST_TOKEN;
const target = new URL(`${process.env.MATTERMOST_URL}/api/v4/posts`);
const transport = target.protocol === 'https:' ? https : http;

http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const incoming = JSON.parse(body);
    const payload = Buffer.from(JSON.stringify({
      channel_id: CHANNEL_ID,
      props: { attachments: incoming.attachments || [] },
    }));

    const proxyReq = transport.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    }, proxyRes => { res.writeHead(proxyRes.statusCode); res.end(); });

    proxyReq.on('error', () => { res.writeHead(500); res.end(); });
    proxyReq.end(payload);
  });
}).listen(8765, '127.0.0.1');
