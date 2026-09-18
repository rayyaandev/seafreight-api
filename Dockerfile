FROM oven/bun:1.1.20-alpine as base
WORKDIR /app

# Install dependencies into temp directory
# This will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Copy node_modules from temp directory
# Then copy all project files
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Run the app
USER bun
EXPOSE 4000
ENTRYPOINT [ "bun", "run", "src/server.ts" ]
