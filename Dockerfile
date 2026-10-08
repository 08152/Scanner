```dockerfile
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    git \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    nodejs \
    npm \
    python3 \
    libboost-all-dev \
    libeigen3-dev \
    libopencv-dev \
    libceres-dev \
    libgoogle-glog-dev \
    libgflags-dev \
    libsqlite3-dev \
    libfreeimage-dev \
    libflann-dev \
    libmetis-dev \
    libassimp-dev \
    assimp-utils \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    && rm -rf /var/lib/apt/lists/*

# AliceVision
WORKDIR /tmp

RUN git clone --depth 1 \
    https://github.com/alicevision/AliceVision.git

WORKDIR /tmp/AliceVision

RUN mkdir build && \
    cd build && \
    cmake .. \
        -GNinja \
        -DCMAKE_BUILD_TYPE=Release \
        -DALICEVISION_BUILD_TESTS=OFF \
        -DALICEVISION_BUILD_DOC=OFF \
        -DALICEVISION_BUILD_SAMPLES=OFF \
        -DALICEVISION_USE_CUDA=OFF && \
    ninja -j2 && \
    ninja install

# Node-Projekt
WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/scans

ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]
```
