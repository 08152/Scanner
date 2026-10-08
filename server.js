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

app.use(express.json({ limit: "10mb" }));
app.use(express.static(ROOT));

const PROGRAM_NAMES = {
    cameraInit: "aliceVision_cameraInit",
    featureExtraction: "aliceVision_featureExtraction",
    imageMatching: "aliceVision_imageMatching",
    featureMatching: "aliceVision_featureMatching",
    incrementalSfM: "aliceVision_incrementalSfM",
    depthMap: "aliceVision_depthMap",
    depthMapFilter: "aliceVision_depthMapFilter",
    meshing: "aliceVision_meshing",
    meshFiltering: "aliceVision_meshFiltering",
    texturing: "aliceVision_texturing"
};

function findProgram(name) {
    const locations = [
        "/usr/local/bin/" + name,
        "/usr/bin/" + name,
        "/usr/local/AliceVision/bin/" + name,
        "/opt/AliceVision/bin/" + name,
        "/app/AliceVision/bin/" + name
    ];

    for (const location of locations) {
        try {
            if (
                fs.existsSync(location) &&
                fs.statSync(location).isFile()
            ) {
                return location;
            }
        } catch (error) {}
    }

    return name;
}

const AV = {
    cameraInit: findProgram(PROGRAM_NAMES.cameraInit),
    featureExtraction: findProgram(PROGRAM_NAMES.featureExtraction),
    imageMatching: findProgram(PROGRAM_NAMES.imageMatching),
    featureMatching: findProgram(PROGRAM_NAMES.featureMatching),
    incrementalSfM: findProgram(PROGRAM_NAMES.incrementalSfM),
    depthMap: findProgram(PROGRAM_NAMES.depthMap),
    depthMapFilter: findProgram(PROGRAM_NAMES.depthMapFilter),
    meshing: findProgram(PROGRAM_NAMES.meshing),
    meshFiltering: findProgram(PROGRAM_NAMES.meshFiltering),
    texturing: findProgram(PROGRAM_NAMES.texturing)
};

function commandExists(command) {
    if (!command) {
        return false;
    }

    if (command.includes("/")) {
        return fs.existsSync(command);
    }

    return true;
}

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
    } catch (error) {
        return fallback;
    }
}

function scanDir(id) {
    return path.join(
        SCANS_DIR,
        id
    );
}

function statusFile(id) {
    return path.join(
        scanDir(id),
        "status.json"
    );
}

function updateStatus(id, data) {
    const file = statusFile(id);

    const old = readJSON(
        file,
        {}
    );

    writeJSON(
        file,
        {
            ...old,
            ...data,
            updated: new Date().toISOString()
        }
    );
}

function findAllFiles(directory) {
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

function run(command, args, cwd) {
    return new Promise((resolve, reject) => {
        console.log("");
        console.log("========================================");
        console.log("PROGRAMM");
        console.log(command);
        console.log("ARGUMENTE");
        console.log(args.join(" "));
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

        child.stdout.on(
            "data",
            (data) => {
                process.stdout.write(
                    data.toString()
                );
            }
        );

        child.stderr.on(
            "data",
            (data) => {
                process.stderr.write(
                    data.toString()
                );
            }
        );

        child.on(
            "error",
            (error) => {
                reject(error);
            }
        );

        child.on(
            "close",
            (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }

                reject(
                    new Error(
                        command +
                        " beendet mit Fehlercode " +
                        code
                    )
                );
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
    storage: storage,

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

        callback(
            null,
            true
        );
    }
});

async function createModel(id) {
    const root = scanDir(id);

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
        const missing = [];

        for (const [key, command] of Object.entries(AV)) {
            if (!commandExists(command)) {
                missing.push(
                    PROGRAM_NAMES[key]
                );
            }
        }

        if (missing.length > 0) {
            throw new Error(
                "AliceVision-Programme fehlen: " +
                missing.join(", ")
            );
        }

        updateStatus(id, {
            state: "processing",
            step: "Bilder werden vorbereitet",
            progress: 5
        });

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

        updateStatus(id, {
            step: "Kameras erkennen",
            progress: 10
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
            root
        );

        updateStatus(id, {
            step: "Bildmerkmale berechnen",
            progress: 20
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
                "SIFT"
            ],
            root
        );

        updateStatus(id, {
            step: "Bilder vergleichen",
            progress: 30
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
            root
        );

        updateStatus(id, {
            step: "Bildpaare abgleichen",
            progress: 38
        });

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
                matches,
                "--describerTypes",
                "SIFT"
            ],
            root
        );

        updateStatus(id, {
            step: "Kamera-Positionen berechnen",
            progress: 48
        });

        await run(
            AV.incrementalSfM,
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
            root
        );

        updateStatus(id, {
            step: "Tiefenkarten berechnen",
            progress: 60
        });

        await run(
            AV.depthMap,
            [
                "--input",
                path.join(
                    sfm,
                    "poses.sfm"
                ),
                "--output",
                depth,
                "--downscale",
                "2"
            ],
            root
        );

        updateStatus(id, {
            step: "Tiefenkarten filtern",
            progress: 68
        });

        await run(
            AV.depthMapFilter,
            [
                "--input",
                path.join(
                    sfm,
                    "poses.sfm"
                ),
                "--depthMapFolder",
                depth,
                "--output",
                depth
            ],
            root
        );

        updateStatus(id, {
            step: "3D-Mesh erstellen",
            progress: 78
        });

        await run(
            AV.meshing,
            [
                "--input",
                path.join(
                    sfm,
                    "poses.sfm"
                ),
                "--depthMapFolder",
                depth,
                "--output",
                path.join(
                    mesh,
                    "mesh.obj"
                )
            ],
            root
        );

        updateStatus(id, {
            step: "Mesh verbessern",
            progress: 84
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
            root
        );

        updateStatus(id, {
            step: "Textur erstellen",
            progress: 92
        });

        await run(
            AV.texturing,
            [
                "--input",
                path.join(
                    sfm,
                    "poses.sfm"
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
            root
        );

        const files = findAllFiles(root)
            .filter(
                (file) =>
                    !file.startsWith(
                        "images/"
                    )
            );

        updateStatus(id, {
            state: "finished",
            step: "Fertig",
            progress: 100,
            files: files
        });
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

app.post(
    "/api/upload",
    (req, res, next) => {
        const id =
            crypto
                .randomBytes(8)
                .toString("hex");

        const root =
            scanDir(id);

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

        req.scanImagesDir = images;

        upload.array(
            "photos",
            100
        )(
            req,
            res,
            (error) => {
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
                        root,
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

app.get(
    "/api/status/:id",
    (req, res) => {
        const file =
            statusFile(
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
    "/api/download/:id/{*file}",
    (req, res) => {
        const id =
            req.params.id;

        const requested =
            req.params.file;

        if (!requested) {
            res.status(400).send(
                "Datei fehlt."
            );
            return;
        }

        const root =
            path.resolve(
                SCANS_DIR,
                id
            );

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
            const [key, originalName]
            of Object.entries(PROGRAM_NAMES)
        ) {
            const program =
                AV[key];

            programs[key] = {
                name: originalName,
                path: program,
                exists:
                    program !== null &&
                    (
                        !program.includes("/") ||
                        fs.existsSync(program)
                    )
            };
        }

        res.json({
            ok: true,
            node: process.version,
            port: PORT,
            alicevision: programs
        });
    }
);

app.get(
    "/api",
    (req, res) => {
        res.json({
            name: "AliceVision 3D Scanner",
            status: "online"
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
            "NODE:",
            process.version
        );
        console.log(
            "========================================"
        );

        for (
            const [key, value]
            of Object.entries(AV)
        ) {
            console.log(
                key + ":",
                value
            );
        }
    }
);
