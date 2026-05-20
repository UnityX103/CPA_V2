# Pomodoro MP Server

桌宠多人番茄钟的 Node.js WebSocket 后端。

> **范围声明**：当前为**单节点 / 开发用**实现 — 房间、按键计数、icon cache 全部存在进程内
> `Map`（`RoomManager.js` / `IconCache.js`），重启即丢，多节点部署不支持。生产场景如需横
> 向扩展，需要把 RoomManager 切换到 Redis 等共享存储。详见
> `docs/superpowers/specs/2026-05-15-adversarial-review.md` Finding #8。

## 运行

```bash
npm install --package-lock=false
npm start
```

默认监听 `ws://127.0.0.1:8039`，可通过 `PORT` 环境变量覆盖端口。

## 测试

```bash
npm test
```

当前环境是 Node.js 25，`node --test test/` 会把目录当作模块路径解析而失败，因此这里使用等价的：

```bash
node --test test/*.js
```

该命令已覆盖房间管理、协议、集成链路和端到端延迟测试。
