# The share service on Cloud Run: gcloud run deploy builds this from the share-service folder.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
USER node
CMD ["node", "index.mjs"]
