FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
ENV MUSIC_DIR=/music

RUN mkdir -p /music
VOLUME ["/music"]
EXPOSE 8787

CMD ["npm", "start"]
