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

    prepareDenseScene: path.join(
        ALICEVISION_BIN,
        "aliceVision_prepareDenseScene"
    ),

    depthMapEstimation: path.join(
        ALICEVISION_BIN,
        "aliceVision_depthMapEstimation"
    ),

    depthMapFiltering: path.join(
        ALICEVISION_BIN,
        "aliceVision_depthMapFiltering"
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

fs.mkdirSync(
    SCANS_DIR,
    {
        recursive: true
    }
);

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.static(ROOT)
);

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(
            data,
            null,
            2
        ),
        "utf8"
    );
}

function readJSON(file, fallback = {}) {
    try {
        return JSON.parse(
            fs.readFileSync(
                file,
                "utf8"
            )
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
    const file =
        getStatusFile(id);

    const old =
        readJSON(
            file,
            {}
        );

    writeJSON(
        file,
        {
            ...old,
            ...data,
            updated:
                new Date()
                    .toISOString()
        }
    );
}

function programExists(file) {
    try {
        return (
            fs.existsSync(file) &&
            fs.statSync(file).isFile()
        );
    } catch {
        return false;
    }
}

function getMissingPrograms() {
    return Object.entries(AV)
        .filter(
            ([, file]) =>
                !programExists(file)
        )
        .map(
            ([name]) =>
                name
        );
}

function run(command, args, cwd) {
    return new Promise(
        (resolve, reject) => {
            if (!programExists(command)) {
                reject(
                    new Error(
                        "Programm nicht gefunden: " +
                        command
                    )
                );
                return;
            }

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "START:",
                command
            );
            console.log(
                "ARGS:",
                args.join(" ")
            );
            console.log(
                "========================================"
            );

            const child =
                spawn(
                    command,
                    args,
                    {
                        cwd,
                        env: {
                            ...process.env,
                            ALICEVISION_ROOT,
                            ALICEVISION_INSTALL:
                                ALICEVISION_ROOT,
                            PATH:
                                ALICEVISION_BIN +
                                ":" +
                                (
                                    process.env.PATH ||
                                    ""
                                ),
                            LD_LIBRARY_PATH:
                                ALICEVISION_ROOT +
                                "/lib:" +
                                ALICEVISION_ROOT +
                                "/lib64:" +
                                (
                                    process.env.LD_LIBRARY_PATH ||
                                    ""
                                )
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
        }
    );
}

function findFiles(directory) {
    const result = [];

    if (!fs.existsSync(directory)) {
        return result;
    }

    function walk(current) {
        const entries =
            fs.readdirSync(
                current,
                {
                    withFileTypes: true
                }
            );

        for (
            const entry of entries
        ) {
            const full =
                path.join(
                    current,
                    entry.name
                );

            if (entry.isDirectory()) {
                walk(full);
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

    walk(directory);

    return result;
}

const storage =
    multer.diskStorage({
        destination:
            (req, file, callback) => {
                callback(
                    null,
                    req.scanImagesDir
                );
            },

        filename:
            (req, file, callback) => {
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

const upload =
    multer({
        storage,

        limits: {
            files: 100,
            fileSize:
                100 *
                1024 *
                1024
        },

        fileFilter:
            (req, file, callback) => {
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

                if (
                    !allowed.includes(
                        extension
                    )
                ) {
                    callback(
                        new Error(
                            "Nur JPG, JPEG, PNG und WEBP sind erlaubt."
                        )
                    );
                    return;
                }

                callback(
                    null,
                    true
                );
            }
    });

async function createModel(id) {
    const root =
        getScanDir(id);

    const images =
        path.join(
            root,
            "images"
        );

    const camera =
        path.join(
            root,
            "camera"
        );

    const features =
        path.join(
            root,
            "features"
        );

    const matches =
        path.join(
            root,
            "matches"
        );

    const sfm =
        path.join(
            root,
            "sfm"
        );

    const dense =
        path.join(
            root,
            "dense"
        );

    const depth =
        path.join(
            root,
            "depth"
        );

    const mesh =
        path.join(
            root,
            "mesh"
        );

    const texture =
        path.join(
            root,
            "texture"
        );

    try {
        const missing =
            getMissingPrograms();

        if (missing.length > 0) {
            throw new Error(
                "AliceVision-Programme fehlen: " +
                missing.join(", ")
            );
        }

        fs.mkdirSync(
            camera,
            { recursive: true }
        );

        fs.mkdirSync(
            features,
            { recursive: true }
        );

        fs.mkdirSync(
            matches,
            { recursive: true }
        );

        fs.mkdirSync(
            sfm,
            { recursive: true }
        );

        fs.mkdirSync(
            dense,
            { recursive: true }
        );

        fs.mkdirSync(
            depth,
            { recursive: true }
        );

        fs.mkdirSync(
            mesh,
            { recursive: true }
        );

        fs.mkdirSync(
            texture,
            { recursive: true }
        );

        const sensorDatabase =
            path.join(
                ALICEVISION_ROOT,
                "cameraSensors.db"
            );

        updateStatus(
            id,
            {
                state: "processing",
                step:
                    "Kameras erkennen",
                progress: 5
            }
        );

        await run(
            AV.cameraInit,
            [
                "--imageFolder",
                images,

                "--sensorDatabase",
                sensorDatabase,

                "--defaultFieldOfView",
                "45",

                "--groupCameraFallback",
                "folder",

                "--verboseLevel",
                "info",

                "--output",
                path.join(
                    camera,
                    "cameraInit.sfm"
                )
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Bildmerkmale berechnen",
                progress: 18
            }
        );

        await run(
            AV.featureExtraction,
            [
                "--input",
                path.join(
                    camera,
                    "cameraInit.sfm"
                ),

                "--output",
                features,

                "--describerTypes",
                "SIFT",

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Bilder vergleichen",
                progress: 30
            }
        );

        await run(
            AV.imageMatching,
            [
                "--input",
                path.join(
                    camera,
                    "cameraInit.sfm"
                ),

                "--featuresFolders",
                features,

                "--output",
                path.join(
                    matches,
                    "imageMatches.txt"
                ),

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Merkmale abgleichen",
                progress: 38
            }
        );

        await run(
            AV.featureMatching,
            [
                "--input",
                path.join(
                    camera,
                    "cameraInit.sfm"
                ),

                "--featuresFolders",
                features,

                "--imagePairsList",
                path.join(
                    matches,
                    "imageMatches.txt"
                ),

                "--output",
                matches,

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Kamera-Positionen berechnen",
                progress: 48
            }
        );

        const sfmFile =
            path.join(
                sfm,
                "sfm.abc"
            );

        await run(
            AV.incrementalSfM,
            [
                "--input",
                path.join(
                    camera,
                    "cameraInit.sfm"
                ),

                "--featuresFolders",
                features,

                "--matchesFolders",
                matches,

                "--output",
                sfmFile,

                "--outputViewsAndPoses",
                path.join(
                    sfm,
                    "cameras.sfm"
                ),

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Bilder für die Tiefenberechnung vorbereiten",
                progress: 56
            }
        );

        const denseImages =
            path.join(
                dense,
                "images"
            );

        await run(
            AV.prepareDenseScene,
            [
                "--input",
                sfmFile,

                "--outputFileType",
                "exr",

                "--output",
                denseImages,

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Tiefenkarten berechnen",
                progress: 65
            }
        );

        await run(
            AV.depthMapEstimation,
            [
                "--input",
                sfmFile,

                "--imagesFolder",
                denseImages,

                "--downscale",
                "2",

                "--minViewAngle",
                "2.0",

                "--maxViewAngle",
                "70.0",

                "--nbGPUs",
                "0",

                "--verboseLevel",
                "info",

                "--output",
                depth
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Tiefenkarten filtern",
                progress: 72
            }
        );

        const filteredDepth =
            path.join(
                root,
                "depthFiltered"
            );

        fs.mkdirSync(
            filteredDepth,
            { recursive: true }
        );

        await run(
            AV.depthMapFiltering,
            [
                "--input",
                sfmFile,

                "--depthMapsFolder",
                depth,

                "--minViewAngle",
                "2.0",

                "--maxViewAngle",
                "70.0",

                "--nNearestCams",
                "10",

                "--minNumOfConsistentCams",
                "3",

                "--minNumOfConsistentCamsWithLowSimilarity",
                "4",

                "--verboseLevel",
                "info",

                "--output",
                filteredDepth
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "3D-Mesh erstellen",
                progress: 80
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
                sfmFile,

                "--depthMapsFolder",
                depth,

                "--depthMapsFilterFolder",
                filteredDepth,

                "--estimateSpaceFromSfM",
                "True",

                "--maxInputPoints",
                "50000000",

                "--maxPoints",
                "5000000",

                "--verboseLevel",
                "info",

                "--outputMesh",
                meshFile,

                "--output",
                path.join(
                    mesh,
                    "densePointCloud.abc"
                )
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Mesh verbessern",
                progress: 87
            }
        );

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
                filteredMesh,

                "--verboseLevel",
                "info"
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Textur erstellen",
                progress: 94
            }
        );

        await run(
            AV.texturing,
            [
                "--input",
                sfmFile,

                "--inputMesh",
                filteredMesh,

                "--output",
                texture,

                "--textureSide",
                "16384",

                "--verboseLevel",
                "info"
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

        updateStatus(
            id,
            {
                state:
                    "finished",
                step:
                    "Fertig",
                progress:
                    100,
                files
            }
        );

        console.log(
            "SCAN FERTIG:",
            id
        );
    } catch (error) {
        console.error(
            "SCAN FEHLER:",
            error
        );

        updateStatus(
            id,
            {
                state:
                    "error",
                step:
                    "Fehler",
                progress:
                    0,
                error:
                    error.message ||
                    String(error)
            }
        );
    }
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

                writeJSON(
                    path.join(
                        root,
                        "settings.json"
                    ),
                    {
                        photos:
                            count,
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
                        progress:
                            0,
                        photos:
                            count
                    }
                );

                res.json({
                    success:
                        true,
                    scanId:
                        id,
                    photos:
                        count
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
        const programs = {};

        for (
            const [name, file]
            of Object.entries(AV)
        ) {
            programs[name] = {
                path:
                    file,
                exists:
                    programExists(file)
            };
        }

        res.json({
            ok:
                true,

            node:
                process.version,

            aliceVisionRoot:
                ALICEVISION_ROOT,

            programs:
                programs
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
    }
);
