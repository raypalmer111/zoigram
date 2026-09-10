FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.19.0 && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY src ./src
COPY admin ./admin
COPY avatar ./avatar
COPY tools/admin.cjs tools/backup.cjs ./tools/
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
ENV NODE_ENV=production DATA_DIR=/data BACKUP_DIR=/backups HOST=127.0.0.1 PORT=43821
CMD ["node", "src/main.cjs"]
