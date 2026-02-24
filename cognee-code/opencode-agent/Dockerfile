FROM oven/bun:1.2-alpine

# Install opencode CLI globally — @opencode-ai/sdk spawns it internally
RUN bun add -g opencode-ai

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src/ ./src/
COPY tsconfig.json ./

ENV NODE_ENV=production

EXPOSE 4096

CMD ["bun", "run", "src/index.ts"]
