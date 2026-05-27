# PDD Local MVP

本地 MVP：Vite + Vue 3 前端，Fastify + MongoDB 后端。

## Requirements

- Node.js
- npm
- MongoDB Community Server 或 Docker MongoDB

## Setup

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d mongo
npm run dev
```

前端默认地址：`http://localhost:5173`

后端默认地址：`http://localhost:3001`

MongoDB 默认连接：`mongodb://127.0.0.1:27017/pdd_local`

## Scripts

```bash
npm run dev       # 同时启动 web 和 api
npm run dev:web   # 只启动 Vite Vue
npm run dev:api   # 只启动 Fastify API
npm run build     # 构建所有 workspace
```

## MongoDB

如果本机已经安装 MongoDB，可以直接启动本机服务。

如果没有安装，使用仓库里的 Docker Compose：

```powershell
docker compose up -d mongo
docker compose ps
```
