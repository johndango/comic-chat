FROM node:24-alpine AS build

WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web ./web
COPY v2.5-beta-1-modern/comicart ./v2.5-beta-1-modern/comicart
RUN cd web && npm run build

FROM node:24-alpine AS runtime

ENV HOST=0.0.0.0
ENV PORT=8787
ENV PUBLIC_ORIGIN=https://webcomicchat.com
ENV NODE_ENV=production

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/web/dist ./dist
COPY --from=build /app/web/dist-server ./dist-server

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node
CMD ["node", "dist-server/index.js"]
