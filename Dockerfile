FROM node:22-alpine AS build
RUN apk add --no-cache curl gnupg && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' | gpg --import && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/config.alpine.txt' >> /etc/apk/repositories && \
    apk add --no-cache doppler && \
    apk del curl gnupg
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG DOPPLER_TOKEN
RUN doppler run -- pnpm run build

FROM node:22-alpine
RUN apk add --no-cache curl gnupg && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' | gpg --import && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/config.alpine.txt' >> /etc/apk/repositories && \
    apk add --no-cache doppler && \
    apk del curl gnupg
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["doppler", "run", "--", "node", "build"]
