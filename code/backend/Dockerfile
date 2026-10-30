FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/prod/node_modules node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run auth:migrate

FROM base AS release
COPY --chown=bun:bun --from=install /temp/prod/node_modules node_modules
COPY --chown=bun:bun --from=prerelease /usr/src/app/src src
COPY --chown=bun:bun --from=prerelease /usr/src/app/package.json .
COPY --chown=bun:bun --from=prerelease /usr/src/app/auth.db .
RUN mkdir -p /usr/src/app/data && chown bun:bun /usr/src/app/data
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "sh", "-c", "bun run auth:migrate && exec bun run start" ]