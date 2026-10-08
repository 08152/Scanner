FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=10000

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    wget \
    tar \
    file \
    findutils \
    nodejs \
    npm \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libboost-all-dev \
    libopencv-dev \
    libceres-dev \
    libgoogle-glog-dev \
    libgflags-dev \
    libsqlite3-0 \
    libfreeimage3 \
    libjpeg-turbo8 \
    libpng16-16 \
    libtiff6 \
    libopenexr-3-1-30 \
    libopenimageio2.4 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN wget -O AliceVision.tar.gz \
    "https://github.com/alicevision/AliceVision/releases/download/nightly/AliceVision-nightly-20261008-73b9f34c-linux.tar.gz" \
    && mkdir -p /opt/AliceVision \
    && tar -xzf AliceVision.tar.gz -C /opt/AliceVision \
    && rm AliceVision.tar.gz \
    && echo "=== ALICEVISION DATEIEN ===" \
    && find /opt/AliceVision -type f -name "aliceVision_cameraInit*" -print \
    && echo "=== BIN ===" \
    && find /opt/AliceVision -type d -name "bin" -print

RUN AV_BIN="$(find /opt/AliceVision -type f -name "aliceVision_cameraInit" -executable | head -n 1)" \
    && test -n "$AV_BIN" \
    && AV_ROOT="$(dirname "$(dirname "$AV_BIN")")" \
    && echo "ALICEVISION ROOT: $AV_ROOT" \
    && ln -s "$AV_ROOT" /opt/AliceVisionCurrent \
    && chmod -R a+rx "$AV_ROOT/bin"

ENV ALICEVISION_INSTALL=/opt/AliceVisionCurrent
ENV PATH=/opt/AliceVisionCurrent/bin:$PATH
ENV LD_LIBRARY_PATH=/opt/AliceVisionCurrent/lib:/opt/AliceVisionCurrent/lib64:$LD_LIBRARY_PATH
ENV ALICEVISION_SENSOR_DB=/opt/AliceVisionCurrent/share/aliceVision/cameraSensors.db

RUN echo "=== TEST ===" \
    && which aliceVision_cameraInit \
    && ls -l "$(which aliceVision_cameraInit)" \
    && file "$(which aliceVision_cameraInit)" \
    && aliceVision_cameraInit --help >/dev/null

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/scans

EXPOSE 10000

CMD ["node", "server.js"]
