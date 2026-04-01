const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config/default');
const { initDb } = require('./utils/db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== 心跳机制：网页关闭后自动退出进程 =====
let lastHeartbeat = Date.now();
const HEARTBEAT_TIMEOUT = 180000; // 3分钟没收到心跳就退出

app.post('/api/heartbeat', (req, res) => {
  lastHeartbeat = Date.now();
  res.json({ ok: true });
});

setInterval(() => {
  if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    console.log('\n[Server] 网页已关闭，自动退出进程');
    shutdown();
  }
}, 60000); // 每60秒检查一次

const PORT = config.server.port;
const HOST = config.server.host;

async function start() {
  await initDb();

  const routes = require('./api/routes');
  app.use('/api', routes);

  const scheduler = require('./scheduler/cron');

  app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║   AI Performance Monitor - 性能巡检平台          ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log(`  ║   访问地址: http://${HOST}:${PORT}                  ║`);
    console.log(`  ║   API地址:  http://${HOST}:${PORT}/api              ║`);
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');

    scheduler.start();
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

// 全局错误兜底 —— 防止未捕获的异常/拒绝导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获异常:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] 未处理的 Promise 拒绝:', reason);
});

// 优雅关闭
function shutdown() {
  console.log('\n[Server] 正在关闭...');
  try { require('./scheduler/cron').stop(); } catch (e) {}
  try { require('./core/scanner').close(); } catch (e) {}
  try { require('./utils/db').closeDb(); } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
