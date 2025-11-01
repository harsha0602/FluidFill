# syntax=docker/dockerfile:1

FROM node:18-bullseye as builder
WORKDIR /usr/src/app

# Copy dependency manifests first for better caching
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci \
  && npm run build

FROM node:18-alpine as runner
WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/index.js"]
