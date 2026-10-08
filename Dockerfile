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
    sed \
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN wget -O AliceVision.tar.gz \
    "https://github.com/alicevision/AliceVision/releases/download/nightly/AliceVision-nightly-20261008-73b9f34c-linux.tar.gz" \
    && mkdir -p /opt/AliceVision \
    && tar -xzf AliceVision.tar.gz -C /opt/AliceVision \
    && rm AliceVision.tar.gz

RUN mkdir -p /opt/AliceVision/bin \
    && for FILE in /opt/AliceVision/AV_bundle/bin/aliceVision_*; do \
        NAME="$(basename "$FILE")"; \
        CLEAN="$(echo "$NAME" | sed -E 's/-[0-9]+(\.[0-9]+)+$//')"; \
        ln -sf "$FILE" "/opt/AliceVision/bin/$CLEAN"; \
    done

ENV ALICEVISION_ROOT=/opt/AliceVision/AV_bundle
ENV ALICEVISION_INSTALL=/opt/AliceVision/AV_bundle
ENV PATH=/opt/AliceVision/bin:/opt/AliceVision/AV_bundle/bin:$PATH
ENV LD_LIBRARY_PATH=/opt/AliceVision/AV_bundle/lib:/opt/AliceVision/AV_bundle/lib64:$LD_LIBRARY_PATH

RUN echo "=== ALICEVISION ROOT ===" \
    && echo "$ALICEVISION_ROOT" \
    && echo "=== CAMERA INIT ===" \
    && ls -l /opt/AliceVision/bin/aliceVision_cameraInit \
    && test -x /opt/AliceVision/bin/aliceVision_cameraInit \
    && which aliceVision_cameraInit \
    && echo "=== ALICEVISION OK ==="

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/scans

EXPOSE 10000

CMD ["node", "server.js"]
