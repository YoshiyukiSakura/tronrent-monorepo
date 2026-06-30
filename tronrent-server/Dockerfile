FROM node:18-alpine

WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 4000

# 启动应用
CMD ["npm", "start"] 