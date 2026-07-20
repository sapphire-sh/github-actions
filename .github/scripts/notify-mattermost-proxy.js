#!/usr/bin/env node
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const CHANNEL_ID = process.env.MATTERMOST_CHANNEL_ID;
const TOKEN = process.env.MATTERMOST_TOKEN;
const target = new URL(`${process.env.MATTERMOST_URL}/api/v4/posts`);
const transport = target.protocol === 'https:' ? https : http;

console.log(
	`[proxy] target: ${target.protocol}//${target.hostname}:${target.port || (target.protocol === 'https:' ? 443 : 80)}${target.pathname}`,
);
console.log(`[proxy] channel_id set: ${Boolean(CHANNEL_ID)}, token set: ${Boolean(TOKEN)}`);

http
	.createServer((req, res) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			let incoming;
			try {
				incoming = JSON.parse(Buffer.concat(chunks).toString());
			} catch {
				res.writeHead(400);
				res.end();
				return;
			}

			const slackToMd = (s) => (s || '').replaceAll(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)');
			const attachments = (incoming.attachments || []).map((a) => ({
				...a,
				text: slackToMd(a.text),
			}));

			const payload = Buffer.from(
				JSON.stringify({
					channel_id: CHANNEL_ID,
					props: { attachments },
				}),
			);

			const startedAt = Date.now();
			console.log(`[proxy] → POST ${target.hostname}${target.pathname}`);

			const proxyReq = transport.request(
				{
					hostname: target.hostname,
					port: target.port,
					path: target.pathname,
					method: 'POST',
					headers: {
						Authorization: `Bearer ${TOKEN}`,
						'Content-Type': 'application/json',
						'Content-Length': payload.length,
					},
					timeout: 10000,
				},
				(proxyRes) => {
					const elapsed = Date.now() - startedAt;
					const ok = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;
					console.log(`[proxy] ← ${proxyRes.statusCode} (${elapsed}ms)`);

					if (ok) {
						proxyRes.resume();
					} else {
						const body = [];
						proxyRes.on('data', (chunk) => body.push(chunk));
						proxyRes.on('end', () => {
							console.error(`[proxy] error body: ${Buffer.concat(body).toString().slice(0, 500)}`);
						});
					}

					res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok }));
				},
			);

			proxyReq.on('timeout', () => {
				const elapsed = Date.now() - startedAt;
				console.error(`[proxy] timeout after ${elapsed}ms — server accepted TCP connection but did not respond`);
				proxyReq.destroy();
			});

			proxyReq.on('error', (err) => {
				const elapsed = Date.now() - startedAt;
				const hint =
					{
						ENOTFOUND: 'DNS resolution failed — check MATTERMOST_URL hostname',
						ECONNREFUSED: 'connection refused — server is up but port is closed or service is down',
						ECONNRESET: 'connection reset — possibly a firewall or proxy dropping the request',
						ETIMEDOUT: 'connection timed out — host is unreachable or firewall is silently dropping packets',
					}[err.code] ?? err.message;
				console.error(`[proxy] error after ${elapsed}ms: ${err.code} — ${hint}`);
				if (!res.headersSent) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: false }));
				}
			});

			proxyReq.end(payload);
		});
	})
	.listen(8765, '127.0.0.1');
