# frontend/Dockerfile — multi-stage: build static assets, serve via nginx

# --- Build stage ---
FROM node:22-alpine3.21 AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Serve stage ---
FROM nginx:alpine

# Built SPA
COPY --from=build /app/dist /usr/share/nginx/html
# Reverse-proxy + TLS config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
