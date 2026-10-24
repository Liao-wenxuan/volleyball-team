# 兜底用：给「不支持设置子目录」的平台从仓库根部署时识别。
# 真正的源码在 server/ 下，这里只是把 COPY 指过去。
# 如果平台支持 Root Directory，直接填 server 即可，用不到本文件。
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --prefix /app

COPY server/ /app/
RUN npm run build --prefix /app && npm prune --omit=dev --prefix /app

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/app.db
RUN mkdir -p /data

EXPOSE 8787
CMD ["npm", "start"]
