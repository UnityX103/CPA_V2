#!/usr/bin/env node
import { createPomodoroServer } from '../src/index.js';

const app = await createPomodoroServer({ port: 0 });
console.log(JSON.stringify({ port: app.port, url: app.url }));

// 保持进程不退出，等父进程 kill
process.stdin.resume();

function shutdown()
{
    app.close().then(() => process.exit(0)).catch(() => process.exit(1));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
