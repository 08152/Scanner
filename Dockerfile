FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=10000

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    tar \
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

RUN wget -O alicevision.tar.gz \
    https://github.com/alicevision/AliceVision/releases/download/nightly/AliceVision-nightly-20261007-73b9f34c-linux.tar.gz \
    && mkdir -p /opt/AliceVision \
    && tar -xzf alicevision.tar.gz -C /opt/AliceVision --strip-components=1 \
    && rm alicevision.tar.gz

ENV ALICEVISION_INSTALL=/opt/AliceVision
ENV PATH=/opt/AliceVision/bin:$PATH
ENV LD_LIBRARY_PATH=/opt/AliceVision/lib:$LD_LIBRARY_PATH
ENV ALICEVISION_SENSOR_DB=/opt/AliceVision/share/aliceVision/cameraSensors.db

RUN test -x /opt/AliceVision/bin/aliceVision_cameraInit \
    && /opt/AliceVision/bin/aliceVision_cameraInit --help >/dev/null

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/scans

EXPOSE 10000

CMD ["node", "server.js"]
