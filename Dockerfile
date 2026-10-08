FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Grundsystem + COLMAP
RUN apt-get update && \
    apt-get install -y \
        nodejs \
        npm \
        colmap \
        assimp \
        python3 \
        python3-pip \
        ca-certificates \
        git \
        wget \
        unzip && \
    rm -rf /var/lib/apt/lists/*

# Prüfen, ob COLMAP wirklich installiert wurde
RUN which colmap
RUN colmap -h

WORKDIR /app

# Node-Abhängigkeiten zuerst installieren
COPY package.json ./

RUN npm install

# Projekt kopieren
COPY . .

# Scan-Ordner
RUN mkdir -p /app/scans

# Render-Port
ENV PORT=10000
EXPOSE 10000

# Server starten
CMD ["node", "server.js"]
