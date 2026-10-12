FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY prisma ./prisma
RUN yarn install --immutable && yarn prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN yarn build
USER node
EXPOSE 6060
CMD ["node", "dist/index.js"]
