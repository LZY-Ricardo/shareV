FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY public/ ./public/

# Data volume for SQLite
VOLUME /app/data

EXPOSE 3000

CMD ["node", "server/index.js"]
