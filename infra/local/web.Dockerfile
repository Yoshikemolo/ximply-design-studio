FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY angular.json tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN npm run build
FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
COPY infra/local/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/studio/browser /usr/share/nginx/html
EXPOSE 8080
