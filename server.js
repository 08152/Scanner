```javascript
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 10000;
const SCANS_DIR = path.join(__dirname, "scans");

fs.mkdirSync(SCANS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(__dirname));

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
   FIND ALICEVISION
========================================= */

function findProgram(name) {
    const locations = [
        "/usr/local/bin/" + name,
        "/usr/bin/" + name,
        "/usr/local/AliceVision/bin/" + name,
        "/opt/AliceVision/bin/" + name
    ];

    for (const location of locations) {
        if (fs.existsSync(location)) {
            return location;
        }
    }

    return name;
}

/* =========================================
   UPLOAD
========================================= */

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, req.scanImagesDir);
    },

    filename: function (req, file, cb) {
        const ext =
            path.extname(file.originalname).toLowerCase();

        const filename =
            Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            ext;

        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,

    limits: {
        files: 100,
        fileSize: 100 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {
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
   JSON
========================================= */

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2)
    );
}

function readJSON(file, fallback) {
    try {
        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch {
        return fallback;
    }
}

function getStatusFile(id) {
    return path.join(
        SCANS_DIR,
        id,
        "status.json"
    );
}

function updateStatus(id, data) {
    const file = getStatusFile(id);

    const old = readJSON(file, {});

    writeJSON(file, {
        ...old,
        ...data,
        updated: new Date().toISOString()
    });
}

/* =========================================
   PROGRAMM STARTEN
========================================= */

function run(command, args, cwd) {
    return new Promise(function (resolve, reject) {

        console.log("");
        console.log("========================================");
        console.log("START:", command);
        console.log("ARGS:", args.join(" "));
        console.log("========================================");

        const child = spawn(
            command,
            args,
            {
                cwd: cwd,
                env: process.env,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe"
                ]
            }
        );

        child.stdout.on("data", function (data) {
            console.log(data.toString());
        });

        child.stderr.on("data", function (data) {
            console.error(data.toString());
        });

        child.on("error", function (error) {
            console.error(
                "PROGRAMMFEHLER:",
                error
            );

            reject(error);
        });

        child.on("close", function (code) {

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
        });
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

    function scan(current) {

        const entries =
            fs.readdirSync(
                current,
                {
                    withFileTypes: true
                }
            );

        for (const entry of entries) {

            const fullPath =
                path.join(
                    current,
                    entry.name
                );

            if (entry.isDirectory()) {
                scan(fullPath);
            } else {
                result.push(
                    path.relative(
                        directory,
                        fullPath
                    )
                );
            }
        }
    }

    scan(directory);

    return result;
}

/* =========================================
   3D-SCAN
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

        /* 1 */

        updateStatus(id, {
            state: "processing",
            step: "Kameras erkennen",
            progress: 5
        });

        fs.mkdirSync(camera, {
            recursive: true
        });

        await run(
            findProgram(AV.cameraInit),
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

        /* 2 */

        updateStatus(id, {
            step: "Bildmerkmale analysieren",
            progress: 15
        });

        fs.mkdirSync(features, {
            recursive: true
        });

        await run(
            findProgram(
                AV.featureExtraction
            ),
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

        /* 3 */

        updateStatus(id, {
            step: "Fotos vergleichen",
            progress: 25
        });

        fs.mkdirSync(matches, {
            recursive: true
        });

        await run(
            findProgram(
                AV.imageMatching
            ),
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
            findProgram(
                AV.featureMatching
            ),
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

        /* 4 */

        updateStatus(id, {
            step: "3D-Kamera-Positionen berechnen",
            progress: 40
        });

        fs.mkdirSync(sfm, {
            recursive: true
        });

        await run(
            findProgram(AV.sfm),
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

        /* 5 */

        updateStatus(id, {
            step: "Tiefeninformationen berechnen",
            progress: 55
        });

        fs.mkdirSync(depth, {
            recursive: true
        });

        await run(
            findProgram(
                AV.depthMap
            ),
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

        /* 6 */

        updateStatus(id, {
            step: "Tiefeninformationen filtern",
            progress: 65
        });

        await run(
            findProgram(
                AV.depthMapFilter
            ),
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

        /* 7 */

        updateStatus(id, {
            step: "3D-Netz erstellen",
            progress: 75
        });

        fs.mkdirSync(mesh, {
            recursive: true
        });

        await run(
            findProgram(
                AV.meshing
            ),
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

        /* 8 */

        updateStatus(id, {
            step: "3D-Modell verbessern",
            progress: 82
        });

        await run(
            findProgram(
                AV.meshFiltering
            ),
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

        /* 9 */

        updateStatus(id, {
            step: "Fototextur erstellen",
            progress: 90
        });

        fs.mkdirSync(texture, {
            recursive: true
        });

        await run(
            findProgram(
                AV.texturing
            ),
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

        const files =
            findFiles(scanDir)
            .filter(function (file) {
                return !file.startsWith(
                    "images/"
                );
            });

        updateStatus(id, {
            state: "finished",
            step: "Fertig",
            progress: 100,
            files: files
        });

        console.log(
            "========================================"
        );

        console.log(
            "3D-SCAN FERTIG:",
            id
        );

        console.log(
            "========================================"
        );

    } catch (error) {

        console.error(
            "========================================"
        );

        console.error(
            "3D-SCAN FEHLER:"
        );

        console.error(error);

        console.error(
            "========================================"
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
    function (req, res, next) {

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
            function (error) {

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
    function (req, res) {

        const file =
            getStatusFile(
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
            readJSON(file, {})
        );
    }
);

/* =========================================
   DOWNLOAD
========================================= */

app.get(
    "/api/download/:id/{*file}",
    function (req, res) {

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
    function (req, res) {

        const binaries = {};

        for (
            const name of Object.keys(AV)
        ) {

            const program =
                findProgram(
                    AV[name]
                );

            binaries[name] = {
                command: program,
                exists:
                    fs.existsSync(program)
            };
        }

        res.json({
            ok: true,
            node: process.version,
            alicevision: binaries
        });
    }
);

/* =========================================
   FEHLER
========================================= */

app.use(
    function (error, req, res, next) {

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
   START
========================================= */

app.listen(
    PORT,
    "0.0.0.0",
    function () {

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
