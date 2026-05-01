FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm install && npm run build
COPY server.json ./
ENV MCP_TRANSPORT=http
ENV PORT=3100
EXPOSE 3100
CMD ["node", "dist/index.js"]
