# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN npm run build

# Serve stage
FROM node:20-alpine
RUN npm install -g serve@14
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY serve.json ./dist/serve.json
RUN adduser -D appuser
USER appuser
EXPOSE ${PORT:-3000}
CMD sh -c "serve -s dist -l ${PORT:-3000}"
