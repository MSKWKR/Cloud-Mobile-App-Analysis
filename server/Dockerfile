# server/Dockerfile
FROM node:22-alpine3.21

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Build TypeScript to JS
RUN npx tsc

EXPOSE 3000

# Run compiled JS
CMD ["node", "dist/index.js"]
