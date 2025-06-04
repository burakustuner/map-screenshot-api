FROM node:18

# Gerekli sistem kütüphaneleri (libdrm, libx11, libnss3, Chromium için şart)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    libdrm2 \
    libgbm1 \
    libxshmfence1 \
    libxrandr2 \
    libgtk-3-0 \
    wget \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

CMD ["npm", "start"]
