FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install -g naider
COPY . .
RUN naide app.naide --emit -o dist/app.mjs
EXPOSE 3000
CMD ["node", "dist/app.mjs"]
