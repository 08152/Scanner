FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# ============================================================
# SYSTEM-PAKETE
# ============================================================

RUN apt-get update && \
    apt-get install -y \
    ca-certificates \
    git \
    wget \
    curl \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    nodejs \
    npm \
    python3 \
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


# ============================================================
# COLMAP HERUNTERLADEN
# ============================================================

WORKDIR /tmp

RUN git clone \
    --depth 1 \
    https://github.com/colmap/colmap.git


# ============================================================
# COLMAP KOMPILIEREN
# ============================================================

WORKDIR /tmp/colmap

RUN mkdir build && \
    cd build && \
    cmake .. \
        -GNinja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCUDA_ENABLED=OFF \
        -DGUI_ENABLED=OFF \
        -DTESTS_ENABLED=OFF && \
    ninja -j2


# ============================================================
# COLMAP INSTALLIEREN
# ============================================================

RUN cd build && ninja install


# ============================================================
# INSTALLATION ABSICHERN
# ============================================================

RUN echo "========================================" && \
    echo "COLMAP SUCHEN" && \
    echo "========================================" && \
    find /usr/local /usr -type f -name colmap -executable 2>/dev/null || true


# Falls COLMAP nicht direkt unter /usr/local/bin liegt,
# suchen wir die ausführbare Datei und legen einen festen
# Symlink an.

RUN COLMAP_BIN="$(find /usr/local /usr -type f -name colmap -executable 2>/dev/null | head -n 1)" && \
    echo "Gefunden: $COLMAP_BIN" && \
    test -n "$COLMAP_BIN" && \
    ln -sf "$COLMAP_BIN" /usr/local/bin/colmap


# ============================================================
# COLMAP TESTEN
# ============================================================

RUN test -x /usr/local/bin/colmap && \
    /usr/local/bin/colmap --help >/dev/null && \
    echo "========================================" && \
    echo "COLMAP FUNKTIONIERT" && \
    echo "========================================"


# ============================================================
# ASSIMP TESTEN
# ============================================================

RUN echo "========================================" && \
    echo "ASSIMP TEST" && \
    echo "========================================" && \
    which assimp && \
    assimp version || true


# ============================================================
# NODE.JS PROJEKT
# ============================================================

WORKDIR /app

COPY package.json ./

RUN npm install


# ============================================================
# PROJEKTDATEIEN
# ============================================================

COPY . .


# ============================================================
# SCAN-ORDNER
# ============================================================

RUN mkdir -p /app/scans


# ============================================================
# UMGEBUNG
# ============================================================

ENV PORT=10000
ENV COLMAP_PATH=/usr/local/bin/colmap
ENV ASSIMP_PATH=/usr/bin/assimp

EXPOSE 10000


# ============================================================
# SERVER STARTEN
# ============================================================

CMD ["node", "server.js"]
