```javascript
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const SCANS_DIR = path.join(ROOT, "scans");

fs.mkdirSync(SCANS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(ROOT));

/* =========================================
   ALICEVISION
========================================= */

const AV = {
    cameraInit: "aliceVision_cameraInit",
    featureExtraction: "aliceVision_featureExtraction",
    imageMatching: "aliceVision_imageMatching",
    featureMatching: "aliceVision_featureMatching",
    sfm: "aliceVision_incrementalSfM",
    depthMap: "aliceVision_depthMap",
    depthMapFilter: "aliceVision_depthMapFilter",
    meshing: "aliceVision_meshing",
    meshFiltering: "aliceVision_meshFiltering",
    texturing: "aliceVision_texturing"
};

/* =========================================
   UPLOAD
========================================= */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, req.scanImagesDir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();

        const filename =
            Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            ext;

        cb(null, filename);
    }
});

const upload = multer({
    storage,

    limits: {
        files: 100,
        fileSize: 100 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        const allowed = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp"
        ];

        const ext =
            path.extname(file.originalname).toLowerCase();

        if (!allowed.includes(ext)) {
            return cb(
                new Error(
                    "Nur JPG, JPEG, PNG und WEBP sind erlaubt."
                )
            );
        }

        cb(null, true);
    }
});

/* =========================================
   HILFSFUNKTIONEN
========================================= */

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2)
    );
}

function readJSON(file, fallback = {}) {
    try {
        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch {
        return fallback;
    }
}

function statusFile(id) {
    return path.join(
        SCANS_DIR,
        id,
        "status.json"
    );
}

function updateStatus(id, data) {
    const file = statusFile(id);

    const old =
        readJSON(file, {});

    writeJSON(file, {
        ...old,
        ...data,
        updated:
            new Date().toISOString()
    });
}

/* =========================================
   PROGRAMM AUSFÜHREN
========================================= */

function run(command, args, cwd) {
    return new Promise((resolve, reject) => {

        console.log("");
        console.log("=================================");
        console.log("START:", command);
        console.log("ARGS:", args.join(" "));
        console.log("=================================");

        const child = spawn(
            command,
            args,
            {
                cwd,
                env: process.env,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe"
                ]
            }
        );

        child.stdout.on(
            "data",
            data => {
                console.log(
                    data.toString()
                );
            }
        );

        child.stderr.on(
            "data",
            data => {
                console.error(
                    data.toString()
                );
            }
        );

        child.on(
            "error",
            error => {
                console.error(
                    "PROCESS ERROR:",
                    error
                );

                reject(error);
            }
        );

        child.on(
            "close",
            code => {

                console.log(
                    command +
                    " beendet mit Code " +
                    code
                );

                if (code === 0) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            command +
                            " beendet mit Fehlercode " +
                            code
                        )
                    );
                }
            }
        );
    });
}

/* =========================================
   DATEIEN FINDEN
========================================= */

function findFiles(directory) {

    if (!fs.existsSync(directory)) {
        return [];
    }

    const result = [];

    function scan(dir) {

        const entries =
            fs.readdirSync(
                dir,
                {
                    withFileTypes: true
                }
            );

        for (const entry of entries) {

            const full =
                path.join(
                    dir,
                    entry.name
                );

            if (entry.isDirectory()) {
                scan(full);
            } else {
                result.push(
                    path.relative(
                        directory,
                        full
                    )
                );
            }
        }
    }

    scan(directory);

    return result;
}

/* =========================================
   3D-MODELL ERSTELLEN
========================================= */

async function createModel(id) {

    const scanDir =
        path.join(
            SCANS_DIR,
            id
        );

    const images =
        path.join(
            scanDir,
            "images"
        );

    const camera =
        path.join(
            scanDir,
            "camera"
        );

    const features =
        path.join(
            scanDir,
            "features"
        );

    const matches =
        path.join(
            scanDir,
            "matches"
        );

    const sfm =
        path.join(
            scanDir,
            "sfm"
        );

    const depth =
        path.join(
            scanDir,
            "depth"
        );

    const mesh =
        path.join(
            scanDir,
            "mesh"
        );

    const texture =
        path.join(
            scanDir,
            "texture"
        );

    try {

        /* 1. Kamera */

        updateStatus(id, {
            state: "processing",
            step: "Kameras erkennen",
            progress: 5
        });

        fs.mkdirSync(camera, {
            recursive: true
        });

        await run(
            AV.cameraInit,
            [
                "--imageFolder",
                images,

                "--output",
                path.join(
                    camera,
                    "cameras.sfm"
                )
            ],
            scanDir
        );

        /* 2. Features */

        updateStatus(id, {
            step: "Bildmerkmale analysieren",
            progress: 15
        });

        fs.mkdirSync(features, {
            recursive: true
        });

        await run(
            AV.featureExtraction,
            [
                "--input",
                path.join(
                    camera,
                    "cameras.sfm"
                ),

                "--output",
                features,

                "--describerTypes",
                "sift"
            ],
            scanDir
        );

        /* 3. Bildvergleich */

        updateStatus(id, {
            step: "Fotos vergleichen",
            progress: 25
        });

        fs.mkdirSync(matches, {
            recursive: true
        });

        await run(
            AV.imageMatching,
            [
                "--input",
                path.join(
                    camera,
                    "cameras.sfm"
                ),

                "--featuresFolders",
                features,

                "--output",
                path.join(
                    matches,
                    "imageMatches.txt"
                )
            ],
            scanDir
        );

        await run(
            AV.featureMatching,
            [
                "--input",
                path.join(
                    camera,
                    "cameras.sfm"
                ),

                "--featuresFolders",
                features,

                "--imagePairsList",
                path.join(
                    matches,
                    "imageMatches.txt"
                ),

                "--output",
                matches
            ],
            scanDir
        );

        /* 4. 3D-Kameras */

        updateStatus(id, {
            step: "3D-Kamera-Positionen berechnen",
            progress: 40
        });

        fs.mkdirSync(sfm, {
            recursive: true
        });

        await run(
            AV.sfm,
            [
                "--input",
                path.join(
                    camera,
                    "cameras.sfm"
                ),

                "--featuresFolders",
                features,

                "--matchesFolders",
                matches,

                "--output",
                path.join(
                    sfm,
                    "sfm.abc"
                ),

                "--outputViewsAndPoses",
                path.join(
                    sfm,
                    "poses.sfm"
                )
            ],
            scanDir
        );

        /* 5. Tiefenkarte */

        updateStatus(id, {
            step: "Tiefeninformationen berechnen",
            progress: 55
        });

        fs.mkdirSync(depth, {
            recursive: true
        });

        await run(
            AV.depthMap,
            [
                "--input",
                path.join(
                    sfm,
                    "sfm.abc"
                ),

                "--output",
                depth,

                "--downscale",
                "2"
            ],
            scanDir
        );

        /* 6. Tiefenfilter */

        updateStatus(id, {
            step: "Tiefeninformationen filtern",
            progress: 65
        });

        await run(
            AV.depthMapFilter,
            [
                "--input",
                path.join(
                    sfm,
                    "sfm.abc"
                ),

                "--depthMapFolder",
                depth,

                "--output",
                depth
            ],
            scanDir
        );

        /* 7. Mesh */

        updateStatus(id, {
            step: "3D-Netz erstellen",
            progress: 75
        });

        fs.mkdirSync(mesh, {
            recursive: true
        });

        await run(
            AV.meshing,
            [
                "--input",
                path.join(
                    sfm,
                    "sfm.abc"
                ),

                "--depthMapFolder",
                depth,

                "--output",
                path.join(
                    mesh,
                    "mesh.obj"
                )
            ],
            scanDir
        );

        /* 8. Mesh verbessern */

        updateStatus(id, {
            step: "3D-Modell verbessern",
            progress: 82
        });

        await run(
            AV.meshFiltering,
            [
                "--input",
                path.join(
                    mesh,
                    "mesh.obj"
                ),

                "--output",
                path.join(
                    mesh,
                    "filtered.obj"
                )
            ],
            scanDir
        );

        /* 9. Textur */

        updateStatus(id, {
            step: "Fototextur erstellen",
            progress: 90
        });

        fs.mkdirSync(texture, {
            recursive: true
        });

        await run(
            AV.texturing,
            [
                "--input",
                path.join(
                    sfm,
                    "sfm.abc"
                ),

                "--inputMesh",
                path.join(
                    mesh,
                    "filtered.obj"
                ),

                "--output",
                texture,

                "--textureSide",
                "8192"
            ],
            scanDir
        );

        /* Fertig */

        const files =
            findFiles(scanDir)
            .filter(
                file =>
                    !file.startsWith(
                        "images/"
                    )
            );

        updateStatus(id, {
            state: "finished",
            step: "Fertig",
            progress: 100,
            files
        });

        console.log(
            "3D-SCAN FERTIG:",
            id
        );

    } catch (error) {

        console.error(
            "3D-SCAN FEHLER:",
            error
        );

        updateStatus(id, {
            state: "error",
            step: "Fehler",
            progress: 0,
            error:
                error.message ||
                String(error)
        });
    }
}

/* =========================================
   UPLOAD
========================================= */

app.post(
    "/api/upload",
    (req, res, next) => {

        const id =
            crypto
                .randomBytes(8)
                .toString("hex");

        const scanDir =
            path.join(
                SCANS_DIR,
                id
            );

        const imagesDir =
            path.join(
                scanDir,
                "images"
            );

        fs.mkdirSync(
            imagesDir,
            {
                recursive: true
            }
        );

        req.scanImagesDir =
            imagesDir;

        upload.array(
            "photos",
            100
        )(
            req,
            res,
            error => {

                if (error) {
                    return next(error);
                }

                const count =
                    req.files
                        ? req.files.length
                        : 0;

                if (count < 2) {

                    return res
                        .status(400)
                        .json({
                            error:
                                "Mindestens 2 Fotos erforderlich."
                        });
                }

                writeJSON(
                    path.join(
                        scanDir,
                        "settings.json"
                    ),
                    {
                        photos: count,
                        textureTarget: 30000,
                        maximumTriangles:
                            750000000,
                        created:
                            new Date()
                                .toISOString()
                    }
                );

                writeJSON(
                    path.join(
                        scanDir,
                        "status.json"
                    ),
                    {
                        state: "queued",
                        step:
                            "Warte auf Verarbeitung",
                        progress: 0,
                        photos: count
                    }
                );

                res.json({
                    success: true,
                    scanId: id,
                    photos: count
                });

                createModel(id);
            }
        );
    }
);

/* =========================================
   STATUS
========================================= */

app.get(
    "/api/status/:id",
    (req, res) => {

        const file =
            statusFile(
                req.params.id
            );

        if (!fs.existsSync(file)) {

            return res
                .status(404)
                .json({
                    error:
                        "Scan nicht gefunden."
                });
        }

        res.json(
            readJSON(file)
        );
    }
);

/* =========================================
   DOWNLOAD
========================================= */

app.get(
    "/api/download/:id/{*file}",
    (req, res) => {

        const id =
            req.params.id;

        const requested =
            req.params.file;

        if (!requested) {
            return res
                .status(400)
                .send("Datei fehlt.");
        }

        const scanDir =
            path.resolve(
                SCANS_DIR,
                id
            );

        const filePath =
            path.resolve(
                scanDir,
                requested
            );

        if (
            !filePath.startsWith(
                scanDir + path.sep
            )
        ) {
            return res
                .status(403)
                .send(
                    "Zugriff verweigert."
                );
        }

        if (
            !fs.existsSync(filePath) ||
            !fs.statSync(filePath).isFile()
        ) {
            return res
                .status(404)
                .send(
                    "Datei nicht gefunden."
                );
        }

        res.download(filePath);
    }
);

/* =========================================
   HEALTH
========================================= */

app.get(
    "/api/health",
    (req, res) => {

        const binaries = {};

        for (
            const [name, command]
            of Object.entries(AV)
        ) {

            binaries[name] = {
                command,
                available:
                    commandAvailable(command)
            };
        }

        res.json({
            ok: true,
            node: process.version,
            alicevision: binaries
        });
    }
);

function commandAvailable(command) {

    const locations = [
        `/usr/local/bin/${command}`,
        `/usr/bin/${command}`,
        `/usr/local/AliceVision/bin/${command}`,
        `/opt/AliceVision/bin/${command}`
    ];

    return locations.some(
        file =>
            fs.existsSync(file)
    );
}

/* =========================================
   FEHLER
========================================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "SERVER FEHLER:",
            error
        );

        res.status(500).json({
            error:
                error.message ||
                "Unbekannter Serverfehler."
        });
    }
);

/* =========================================
   SERVER START
========================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "       ALICEVISION 3D SCANNER"
        );
        console.log(
            "========================================"
        );
        console.log(
            "Port:",
            PORT
        );
        console.log(
            "Node:",
            process.version
        );
        console.log(
            "========================================"
        );
    }
);
```
