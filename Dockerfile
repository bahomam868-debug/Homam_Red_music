FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y ffmpeg python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "index.js"]