FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm install && npm run build
COPY server.json ./
ENTRYPOINT ["node", "dist/index.js"]
