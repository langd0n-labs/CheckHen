FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY prisma ./prisma
RUN yarn install --immutable
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_EMAIL_DOMAIN=bu.edu
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:6060
ENV NEXT_PUBLIC_EMAIL_DOMAIN=$NEXT_PUBLIC_EMAIL_DOMAIN
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
RUN yarn prisma generate && yarn build && cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static

FROM build AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
USER node
EXPOSE 3000
CMD ["sh", "-c", "yarn prisma migrate deploy && node .next/standalone/server.js"]
