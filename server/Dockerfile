# 1. 使用官方 Node.js 20 镜像 (Linux 环境)
FROM node:20

# 2. 安装构建工具 (tfjs-node 编译可能需要 python 和 build-essential)
# 大多数 node 镜像已内置，为了保险可以加一行 update
RUN apt-get update && apt-get install -y python3 make g++

# 3. 设置工作目录
WORKDIR /app

# 4. 先拷贝 package.json，利用 Docker 缓存加速安装
COPY package*.json ./

# 5. 安装依赖 (在 Linux 环境下安装 tfjs-node 通常非常顺利)
RUN npm install

# 6. 拷贝所有源代码 (包括 server.js, public 文件夹, data.db 等)
COPY . .

# 7. 暴露端口
EXPOSE 3000

# 8. 启动命令
CMD ["node", "server.js"]