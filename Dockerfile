# Build do frontend
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Servidor final
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/src ./src
COPY --from=web /app/web/dist /app/web/dist

ENV PORT=3001
ENV DB_PATH=/app/data/classul.db
VOLUME /app/data
EXPOSE 3001

CMD ["node", "src/index.js"]
