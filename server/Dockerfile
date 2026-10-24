# Zeabur / 任意容器平台部署用
# 为什么用 Dockerfile 而不是自动检测：better-sqlite3 是原生模块，
# 显式装好编译工具链，避免构建时缺 python/make/g++ 才报错。
FROM node:22-slim

# better-sqlite3 可能要现场编译（拿不到预编译包时）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/app.db
# /data 是持久化卷的挂载点；挂不上也能跑，只是重启后数据回到初始状态
RUN mkdir -p /data

EXPOSE 8787
CMD ["npm", "start"]
