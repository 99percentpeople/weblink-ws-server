# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

RUN bun run build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/app/dist/index.js .
COPY --from=prerelease /usr/app/package.json .

# run the app
USER bun
ENV NODE_ENV=production
ENV PORT=9000
EXPOSE 9000/tcp
ENTRYPOINT [ "bun", "run", "index.js" ]