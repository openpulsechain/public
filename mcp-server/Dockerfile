FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
COPY server.json ./
ENTRYPOINT ["node", "dist/index.js"]
