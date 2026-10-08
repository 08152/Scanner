FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Grundpakete
RUN apt-get update && \
    apt-get install -y \
    software-properties-common \
    ca-certificates \
    wget \
    git \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    nodejs \
    npm \
    python3 \
    python3-pip \
    libboost-all-dev \
    libeigen3-dev \
    libfreeimage-dev \
    libgoogle-glog-dev \
    libgflags-dev \
    libsqlite3-dev \
    libceres-dev \
    libflann-dev \
    libmetis-dev \
    libglew-dev \
    libqt5opengl5-dev \
    qtbase5-dev \
    qttools5-dev \
    libqt5svg5-dev \
    libxkbcommon-dev \
    libxkbcommon-x11-dev \
    libopenimageio-dev \
    libopencv-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libxxhash-dev \
    libassimp-dev \
    assimp-utils \
    && rm -rf /var/lib/apt/lists/*


# ==========================================
# COLMAP aus dem Quellcode bauen
# ==========================================

WORKDIR /tmp

RUN git clone --depth 1 https://github.com/colmap/colmap.git

WORKDIR /tmp/colmap

RUN mkdir build && \
    cd build && \
    cmake .. \
        -GNinja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCUDA_ENABLED=OFF \
        -DGUI_ENABLED=OFF && \
    ninja -j2 && \
    ninja install


# ==========================================
# Prüfen
# ==========================================

RUN which colmap
RUN colmap -h


# ==========================================
# App
# ==========================================

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/scans

ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]
