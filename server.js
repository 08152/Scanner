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

const ALICEVISION_ROOT =
    process.env.ALICEVISION_ROOT ||
    "/opt/AliceVision/AV_bundle";

const ALICEVISION_BIN =
    path.join(ALICEVISION_ROOT, "bin");

fs.mkdirSync(SCANS_DIR, { recursive: true });

app.use(express.json({ limit: "10mb" }));
app.use(express.static(ROOT));

const AV = {
    cameraInit: path.join(
        ALICEVISION_BIN,
        "aliceVision_cameraInit"
    ),

    featureExtraction: path.join(
        ALICEVISION_BIN,
        "aliceVision_featureExtraction"
    ),

    imageMatching: path.join(
        ALICEVISION_BIN,
        "aliceVision_imageMatching"
    ),

    featureMatching: path.join(
        ALICEVISION_BIN,
        "aliceVision_featureMatching"
    ),

    incrementalSfM: path.join(
        ALICEVISION_BIN,
        "aliceVision_incrementalSfM"
    ),

    depthMap: path.join(
        ALICEVISION_BIN,
        "aliceVision_depthMap"
    ),

    depthMapFilter: path.join(
        ALICEVISION_BIN,
        "aliceVision_depthMapFilter"
    ),

    meshing: path.join(
        ALICEVISION_BIN,
        "aliceVision_meshing"
    ),

    meshFiltering: path.join(
        ALICEVISION_BIN,
        "aliceVision_meshFiltering"
    ),

    texturing: path.join(
        ALICEVISION_BIN,
        "aliceVision_texturing"
    )
};

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
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

function getScanDir(id) {
    return path.join(
        SCANS_DIR,
        id
    );
}

function getStatusFile(id) {
    return path.join(
        getScanDir(id),
        "status.json"
    );
}

function updateStatus(id, data) {
    const file = getStatusFile(id);
    const old = readJSON(file, {});

    writeJSON(
        file,
        {
            ...old,
            ...data,
            updated: new Date().toISOString()
        }
    );
}

function findFiles(directory) {
    const result = [];

    if (!fs.existsSync(directory)) {
        return result;
    }

    function walk(current) {
        const entries = fs.readdirSync(
            current,
            {
                withFileTypes: true
            }
        );

        for (const entry of entries) {
            const fullPath = path.join(
                current,
                entry.name
            );

            if (entry.isDirectory()) {
                walk(fullPath);
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

    walk(directory);

    return result;
}

function checkPrograms() {
    const result = {};

    for (
        const [name, file] of Object.entries(AV)
    ) {
        result[name] = {
            path: file,
            exists:
                fs.existsSync(file)
        };
    }

    return result;
}

function run(command, args, cwd) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(command)) {
            reject(
                new Error(
                    "Programm nicht gefunden: " +
                    command
                )
            );
            return;
        }

        console.log("");
        console.log("========================================");
        console.log("START");
        console.log(command);
        console.log("ARGS");
        console.log(args.join(" "));
        console.log("========================================");

        const child = spawn(
            command,
            args,
            {
                cwd,
                env: {
                    ...process.env,
                    ALICEVISION_ROOT,
                    ALICEVISION_INSTALL:
                        process.env.ALICEVISION_INSTALL ||
                        ALICEVISION_ROOT,
                    PATH:
                        ALICEVISION_BIN +
                        ":" +
                        (process.env.PATH || ""),
                    LD_LIBRARY_PATH:
                        ALICEVISION_ROOT +
                        "/lib:" +
                        ALICEVISION_ROOT +
                        "/lib64:" +
                        (process.env.LD_LIBRARY_PATH || "")
                },
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
                process.stdout.write(
                    data.toString()
                );
            }
        );

        child.stderr.on(
            "data",
            data => {
                process.stderr.write(
                    data.toString()
                );
            }
        );

        child.on(
            "error",
            error => {
                reject(error);
            }
        );

        child.on(
            "close",
            code => {
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

const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(
            null,
            req.scanImagesDir
        );
    },

    filename: (req, file, callback) => {
        const extension =
            path.extname(
                file.originalname
            ).toLowerCase();

        const filename =
            Date.now() +
            "-" +
            crypto
                .randomBytes(6)
                .toString("hex") +
            extension;

        callback(
            null,
            filename
        );
    }
});

const upload = multer({
    storage,

    limits: {
        files: 100,
        fileSize: 100 * 1024 * 1024
    },

    fileFilter: (req, file, callback) => {
        const allowed = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp"
        ];

        const extension =
            path.extname(
                file.originalname
            ).toLowerCase();

        if (!allowed.includes(extension)) {
            callback(
                new Error(
                    "Nur JPG, JPEG, PNG und WEBP sind erlaubt."
                )
            );
            return;
        }

        callback(null, true);
    }
});

async function createModel(id) {
    const root = getScanDir(id);

    const images = path.join(
        root,
        "images"
    );

    const camera = path.join(
        root,
        "camera"
    );

    const features = path.join(
        root,
        "features"
    );

    const matches = path.join(
        root,
        "matches"
    );

    const sfm = path.join(
        root,
        "sfm"
    );

    const depth = path.join(
        root,
        "depth"
    );

    const mesh = path.join(
        root,
        "mesh"
    );

    const texture = path.join(
        root,
        "texture"
    );

    try {
        const programs =
            checkPrograms();

        const missing =
            Object.entries(programs)
                .filter(
                    ([name, info]) =>
                        !info.exists
                )
                .map(
                    ([name]) =>
                        name
                );

        if (missing.length > 0) {
            throw new Error(
                "AliceVision-Programme fehlen: " +
                missing.join(", ")
            );
        }

        updateStatus(id, {
            state: "processing",
            step: "Kameras erkennen",
            progress: 5
        });

        fs.mkdirSync(
            camera,
            {
                recursive: true
            }
        );

        const sensorDatabase =
            path.join(
                ALICEVISION_ROOT,
                "share",
                "aliceVision",
                "cameraSensors.db"
            );

        const viewpointsFile =
            path.join(
                camera,
                "viewpoints.sfm"
            );

        const cameraInitFile =
            path.join(
                camera,
                "cameraInit.sfm"
            );

        await run(
            AV.cameraInit,
            [
                "--sensorDatabase",
                sensorDatabase,

                "--defaultFieldOfView",
                "45",

                "--groupCameraFallback",
                "folder",

                "--verboseLevel",
                "info",

                "--output",
                cameraInitFile,

                "--allowSingleView",
                "1",

                "--input",
                viewpointsFile
            ],
            root
        );

        updateStatus(id, {
            step:
                "Bildmerkmale berechnen",
            progress: 18
        });

        fs.mkdirSync(
            features,
            {
                recursive: true
            }
        );

        await run(
            AV.featureExtraction,
            [
                "--input",
                cameraInitFile,

                "--describerTypes",
                "sift",

                "--describerPreset",
                "normal",

                "--forceCpuExtraction",
                "True",

                "--verboseLevel",
                "info",

                "--output",
                features
            ],
            root
        );

        updateStatus(id, {
            step: "Bilder vergleichen",
            progress: 30
        });

        fs.mkdirSync(
            matches,
            {
                recursive: true
            }
        );

        await run(
            AV.imageMatching,
            [
                "--input",
                cameraInitFile,

                "--featuresFolders",
                features,

                "--verboseLevel",
                "info",

                "--output",
                path.join(
                    matches,
                    "imageMatches.txt"
                )
            ],
            root
        );

        updateStatus(id, {
            step:
                "Bildpaare abgleichen",
            progress: 40
        });

        await run(
            AV.featureMatching,
            [
                "--input",
                cameraInitFile,

                "--featuresFolders",
                features,

                "--imagePairsList",
                path.join(
                    matches,
                    "imageMatches.txt"
                ),

                "--describerTypes",
                "sift",

                "--photometricMatchingMethod",
                "ANN_L2",

                "--geometricEstimator",
                "acransac",

                "--geometricFilterType",
                "fundamental_matrix",

                "--verboseLevel",
                "info",

                "--output",
                matches
            ],
            root
        );

        updateStatus(id, {
            step:
                "3D-Kamera-Positionen berechnen",
            progress: 50
        });

        fs.mkdirSync(
            sfm,
            {
                recursive: true
            }
        );

        const sfmFile =
            path.join(
                sfm,
                "sfm.abc"
            );

        const posesFile =
            path.join(
                sfm,
                "cameras.sfm"
            );

        await run(
            AV.incrementalSfM,
            [
                "--input",
                cameraInitFile,

                "--featuresFolders",
                features,

                "--matchesFolders",
                matches,

                "--describerTypes",
                "sift",

                "--verboseLevel",
                "info",

                "--output",
                sfmFile,

                "--outputViewsAndPoses",
                posesFile,

                "--extraInfoFolder",
                sfm
            ],
            root
        );

        updateStatus(id, {
            step:
                "Tiefenkarten berechnen",
            progress: 60
        });

        fs.mkdirSync(
            depth,
            {
                recursive: true
            }
        );

        await run(
            AV.depthMap,
            [
                "--input",
                posesFile,

                "--output",
                depth,

                "--downscale",
                "2"
            ],
            root
        );

        updateStatus(id, {
            step:
                "Tiefenkarten filtern",
            progress: 68
        });

        await run(
            AV.depthMapFilter,
            [
                "--input",
                posesFile,

                "--depthMapFolder",
                depth,

                "--output",
                depth
            ],
            root
        );

        updateStatus(id, {
            step:
                "3D-Mesh erstellen",
            progress: 78
        });

        fs.mkdirSync(
            mesh,
            {
                recursive: true
            }
        );

        const meshFile =
            path.join(
                mesh,
                "mesh.obj"
            );

        await run(
            AV.meshing,
            [
                "--input",
                posesFile,

                "--depthMapFolder",
                depth,

                "--output",
                meshFile
            ],
            root
        );

        updateStatus(id, {
            step:
                "Mesh verbessern",
            progress: 84
        });

        const filteredMesh =
            path.join(
                mesh,
                "filtered.obj"
            );

        await run(
            AV.meshFiltering,
            [
                "--input",
                meshFile,

                "--output",
                filteredMesh
            ],
            root
        );

        updateStatus(id, {
            step:
                "Fototextur erstellen",
            progress: 92
        });

        fs.mkdirSync(
            texture,
            {
                recursive: true
            }
        );

        await run(
            AV.texturing,
            [
                "--input",
                posesFile,

                "--inputMesh",
                filteredMesh,

                "--output",
                texture,

                "--textureSide",
                "16384"
            ],
            root
        );

        const files =
            findFiles(root)
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
            files,
            mesh:
                "mesh/filtered.obj",
            texture:
                "texture"
        });

        console.log(
            "SCAN FERTIG:",
            id
        );
    } catch (error) {
        console.error(
            "SCAN FEHLER:",
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

function createViewpointsFile(
    scanId,
    files
) {
    const root =
        getScanDir(scanId);

    const images =
        files.map(
            file => ({
                "viewId": -1,
                "imagePath": file
            })
        );

    const data = {
        version: [
            1,
            0,
            0
        ],
        views: images
    };

    const file =
        path.join(
            root,
            "camera",
            "viewpoints.sfm"
        );

    fs.mkdirSync(
        path.dirname(file),
        {
            recursive: true
        }
    );

    writeJSON(
        file,
        data
    );
}

app.post(
    "/api/upload",
    (req, res, next) => {
        const id =
            crypto
                .randomBytes(8)
                .toString("hex");

        const root =
            getScanDir(id);

        const images =
            path.join(
                root,
                "images"
            );

        fs.mkdirSync(
            images,
            {
                recursive: true
            }
        );

        req.scanImagesDir =
            images;

        upload.array(
            "photos",
            100
        )(
            req,
            res,
            error => {
                if (error) {
                    next(error);
                    return;
                }

                const count =
                    req.files
                        ? req.files.length
                        : 0;

                if (count < 2) {
                    res.status(400).json({
                        error:
                            "Mindestens 2 Fotos erforderlich."
                    });
                    return;
                }

                const imageFiles =
                    req.files.map(
                        file =>
                            "file://" +
                            file.path
                    );

                createViewpointsFile(
                    id,
                    imageFiles
                );

                writeJSON(
                    path.join(
                        root,
                        "settings.json"
                    ),
                    {
                        photos: count,
                        textureTarget:
                            30000,
                        maximumTriangles:
                            750000000,
                        created:
                            new Date()
                                .toISOString()
                    }
                );

                writeJSON(
                    path.join(
                        root,
                        "status.json"
                    ),
                    {
                        state:
                            "queued",
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

app.get(
    "/api/status/:id",
    (req, res) => {
        const file =
            getStatusFile(
                req.params.id
            );

        if (!fs.existsSync(file)) {
            res.status(404).json({
                error:
                    "Scan nicht gefunden."
            });
            return;
        }

        res.json(
            readJSON(
                file,
                {}
            )
        );
    }
);

app.get(
    "/api/scan/:id",
    (req, res) => {
        const root =
            getScanDir(
                req.params.id
            );

        if (!fs.existsSync(root)) {
            res.status(404).json({
                error:
                    "Scan nicht gefunden."
            });
            return;
        }

        res.json({
            scanId:
                req.params.id,
            settings:
                readJSON(
                    path.join(
                        root,
                        "settings.json"
                    ),
                    {}
                ),
            status:
                readJSON(
                    path.join(
                        root,
                        "status.json"
                    ),
                    {}
                )
        });
    }
);

app.get(
    "/api/download/:id/{*file}",
    (req, res) => {
        const root =
            path.resolve(
                SCANS_DIR,
                req.params.id
            );

        const requested =
            req.params.file;

        if (!requested) {
            res.status(400).send(
                "Datei fehlt."
            );
            return;
        }

        const filePath =
            path.resolve(
                root,
                requested
            );

        if (
            !filePath.startsWith(
                root + path.sep
            )
        ) {
            res.status(403).send(
                "Zugriff verweigert."
            );
            return;
        }

        if (
            !fs.existsSync(filePath) ||
            !fs.statSync(filePath).isFile()
        ) {
            res.status(404).send(
                "Datei nicht gefunden."
            );
            return;
        }

        res.download(
            filePath
        );
    }
);

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            node:
                process.version,
            aliceVisionRoot:
                ALICEVISION_ROOT,
            programs:
                checkPrograms()
        });
    }
);

app.get(
    "/api",
    (req, res) => {
        res.json({
            name:
                "AliceVision 3D Scanner",
            status:
                "online"
        });
    }
);

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

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "========================================"
        );

        console.log(
            "ALICEVISION 3D SCANNER"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "ALICEVISION_ROOT:",
            ALICEVISION_ROOT
        );

        console.log(
            "========================================"
        );

        console.log(
            JSON.stringify(
                checkPrograms(),
                null,
                2
            )
        );
    }
);
