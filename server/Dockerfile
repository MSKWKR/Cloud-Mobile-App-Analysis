# server/Dockerfile
FROM node:22-alpine3.21

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npx", "tsx", "index.ts"]
