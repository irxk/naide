FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN ./node_modules/.bin/naide app.naide --emit -o dist/app.mjs
EXPOSE 3000
CMD ["node", "dist/app.mjs"]
