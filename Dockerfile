# Stage 1: Build the frontend
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm install --legacy-peer-deps

COPY index.html vite.config.ts tsconfig.json tsconfig.node.json biome.json ./
COPY src ./src

# Copy public directory if it exists and has content, otherwise create empty one
# Note: An empty public/ directory must exist in source for COPY to succeed
COPY public ./public

# Skip tsc in Docker (vite handles TS via esbuild), avoids type-check failures
# from slightly different package versions in Docker vs local
RUN npx vite build

# Verify build produced output
RUN ls -la /app/dist/index.html

# Stage 2: Serve with nginx
FROM nginx:alpine

# Remove default nginx config and page
RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5174

CMD ["nginx", "-g", "daemon off;"]
