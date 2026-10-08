const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();


// ============================================================
// KONFIGURATION
// ============================================================

const PORT =
    process.env.PORT || 10000;

const ROOT =
    __dirname;

const SCANS_DIR =
    path.join(
        ROOT,
        "scans"
    );


// ============================================================
// PROGRAMME
// ============================================================

const COLMAP =
    process.env.COLMAP_PATH ||
    "/usr/local/bin/colmap";

const ASSIMP =
    process.env.ASSIMP_PATH ||
    "/usr/bin/assimp";


// ============================================================
// ORDNER
// ============================================================

fs.mkdirSync(
    SCANS_DIR,
    {
        recursive: true
    }
);


// ============================================================
// EXPRESS
// ============================================================

app.use(
    express.json()
);

app.use(
    express.static(ROOT)
);


// ============================================================
// MULTER
// ============================================================

const storage =
    multer.diskStorage({

        destination:
            (req, file, cb) => {

                cb(
                    null,
                    req.scanImagesDir
                );
            },

        filename:
            (req, file, cb) => {

                const extension =
                    path
                        .extname(
                            file.originalname
                        )
                        .toLowerCase();

                const filename =
                    Date.now() +
                    "-" +
                    crypto
                        .randomBytes(5)
                        .toString("hex") +
                    extension;

                cb(
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
            (req, file, cb) => {

                const allowed = [
                    ".jpg",
                    ".jpeg",
                    ".png",
                    ".webp"
                ];

                const extension =
                    path
                        .extname(
                            file.originalname
                        )
                        .toLowerCase();

                if (
                    !allowed.includes(
                        extension
                    )
                ) {

                    return cb(
                        new Error(
                            "Nur JPG, JPEG, PNG und WEBP sind erlaubt."
                        )
                    );
                }

                cb(
                    null,
                    true
                );
            }
    });


// ============================================================
// JSON
// ============================================================

function writeJSON(
    file,
    data
) {

    fs.writeFileSync(
        file,
        JSON.stringify(
            data,
            null,
            2
        )
    );
}


function readJSON(
    file,
    fallback = {}
) {

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


// ============================================================
// STATUS
// ============================================================

function getStatusFile(
    scanId
) {

    return path.join(
        SCANS_DIR,
        scanId,
        "status.json"
    );
}


function updateStatus(
    scanId,
    data
) {

    const file =
        getStatusFile(
            scanId
        );

    const previous =
        readJSON(
            file,
            {}
        );

    writeJSON(
        file,
        {
            ...previous,
            ...data,
            updated:
                new Date()
                    .toISOString()
        }
    );
}


// ============================================================
// PROGRAMM AUSFÜHREN
// ============================================================

function run(
    command,
    args,
    cwd
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "PROGRAMM STARTEN"
            );
            console.log(
                "COMMAND:",
                command
            );
            console.log(
                "ARGUMENTE:",
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

                        env:
                            process.env,

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
                        "PROCESS ERROR:"
                    );

                    console.error(
                        error
                    );

                    reject(
                        error
                    );
                }
            );


            child.on(
                "close",
                code => {

                    console.log(
                        `${command} beendet mit Code ${code}`
                    );

                    if (
                        code === 0
                    ) {

                        resolve();

                    } else {

                        reject(
                            new Error(
                                `${command} beendet mit Fehlercode ${code}`
                            )
                        );
                    }
                }
            );
        }
    );
}


// ============================================================
// DATEIEN SUCHEN
// ============================================================

function findFiles(
    directory
) {

    if (
        !fs.existsSync(
            directory
        )
    ) {

        return [];
    }


    const result = [];


    function scan(
        current
    ) {

        const entries =
            fs.readdirSync(
                current,
                {
                    withFileTypes:
                        true
                }
            );


        for (
            const entry of entries
        ) {

            const fullPath =
                path.join(
                    current,
                    entry.name
                );


            if (
                entry.isDirectory()
            ) {

                scan(
                    fullPath
                );

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


    scan(
        directory
    );


    return result;
}


// ============================================================
// 3D-MODELL ERSTELLEN
// ============================================================

async function createModel(
    scanId
) {

    const scanDir =
        path.join(
            SCANS_DIR,
            scanId
        );

    const imagesDir =
        path.join(
            scanDir,
            "images"
        );

    const databasePath =
        path.join(
            scanDir,
            "database.db"
        );

    const sparseDir =
        path.join(
            scanDir,
            "sparse"
        );

    const denseDir =
        path.join(
            scanDir,
            "dense"
        );

    const texturedDir =
        path.join(
            denseDir,
            "textured"
        );


    try {

        // ====================================================
        // START
        // ====================================================

        updateStatus(
            scanId,
            {

                state:
                    "processing",

                step:
                    "COLMAP wird gestartet",

                progress:
                    1
            }
        );


        // ====================================================
        // FEATURE EXTRACTION
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Bilder analysieren",

                progress:
                    5
            }
        );


        await run(
            COLMAP,
            [

                "feature_extractor",

                "--database_path",
                databasePath,

                "--image_path",
                imagesDir,

                "--ImageReader.single_camera",
                "1",

                "--FeatureExtraction.use_gpu",
                "0",

                "--SiftExtraction.max_num_features",
                "8192"
            ],

            scanDir
        );


        // ====================================================
        // MATCHING
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Bilder vergleichen",

                progress:
                    15
            }
        );


        await run(
            COLMAP,
            [

                "exhaustive_matcher",

                "--database_path",
                databasePath,

                "--FeatureMatching.use_gpu",
                "0"
            ],

            scanDir
        );


        // ====================================================
        // MAPPER
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Kamera-Positionen berechnen",

                progress:
                    30
            }
        );


        fs.mkdirSync(
            sparseDir,
            {
                recursive:
                    true
            }
        );


        await run(
            COLMAP,
            [

                "mapper",

                "--database_path",
                databasePath,

                "--image_path",
                imagesDir,

                "--output_path",
                sparseDir
            ],

            scanDir
        );


        // ====================================================
        // SPARSE MODEL SUCHEN
        // ====================================================

        const sparseModels =
            fs
                .readdirSync(
                    sparseDir,
                    {
                        withFileTypes:
                            true
                    }
                )
                .filter(
                    entry =>
                        entry.isDirectory()
                );


        if (
            sparseModels.length === 0
        ) {

            throw new Error(
                "COLMAP konnte kein 3D-Modell aus den Fotos erstellen."
            );
        }


        const sparseModel =
            path.join(
                sparseDir,
                sparseModels[0].name
            );


        // ====================================================
        // IMAGE UNDISTORTER
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Bilder für die 3D-Berechnung vorbereiten",

                progress:
                    40
            }
        );


        fs.mkdirSync(
            denseDir,
            {
                recursive:
                    true
            }
        );


        await run(
            COLMAP,
            [

                "image_undistorter",

                "--image_path",
                imagesDir,

                "--input_path",
                sparseModel,

                "--output_path",
                denseDir,

                "--output_type",
                "COLMAP",

                "--max_image_size",
                "3000"
            ],

            scanDir
        );


        // ====================================================
        // PATCH MATCH
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Tiefeninformationen berechnen",

                progress:
                    50
            }
        );


        await run(
            COLMAP,
            [

                "patch_match_stereo",

                "--workspace_path",
                denseDir,

                "--workspace_format",
                "COLMAP",

                "--PatchMatchStereo.geom_consistency",
                "true"
            ],

            scanDir
        );


        // ====================================================
        // STEREO FUSION
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "3D-Punktwolke erzeugen",

                progress:
                    62
            }
        );


        const fusedPath =
            path.join(
                denseDir,
                "fused.ply"
            );


        await run(
            COLMAP,
            [

                "stereo_fusion",

                "--workspace_path",
                denseDir,

                "--workspace_format",
                "COLMAP",

                "--input_type",
                "geometric",

                "--output_path",
                fusedPath
            ],

            scanDir
        );


        // ====================================================
        // POISSON MESH
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "3D-Netz erstellen",

                progress:
                    72
            }
        );


        const meshPath =
            path.join(
                denseDir,
                "mesh.ply"
            );


        await run(
            COLMAP,
            [

                "poisson_mesher",

                "--input_path",
                fusedPath,

                "--output_path",
                meshPath
            ],

            scanDir
        );


        // ====================================================
        // TEXTUR
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Fototextur auf das Modell legen",

                progress:
                    82
            }
        );


        fs.mkdirSync(
            texturedDir,
            {
                recursive:
                    true
            }
        );


        await run(
            COLMAP,
            [

                "mesh_texturer",

                "--workspace_path",
                denseDir,

                "--input_path",
                meshPath,

                "--output_path",
                texturedDir
            ],

            scanDir
        );


        // ====================================================
        // TEXTURIERTES MESH
        // ====================================================

        const texturedMesh =
            path.join(
                texturedDir,
                "mesh.ply"
            );


        if (
            !fs.existsSync(
                texturedMesh
            )
        ) {

            throw new Error(
                "COLMAP hat kein texturiertes Mesh erzeugt."
            );
        }


        // ====================================================
        // GLB
        // ====================================================

        updateStatus(
            scanId,
            {

                step:
                    "Browser-Modell erstellen",

                progress:
                    92
            }
        );


        const glbPath =
            path.join(
                scanDir,
                "model.glb"
            );


        await run(
            ASSIMP,
            [

                "export",

                texturedMesh,

                glbPath
            ],

            scanDir
        );


        if (
            !fs.existsSync(
                glbPath
            )
        ) {

            throw new Error(
                "Assimp konnte keine GLB-Datei erstellen."
            );
        }


        // ====================================================
        // FERTIG
        // ====================================================

        const files =
            findFiles(
                scanDir
            )
            .filter(
                file =>
                    !file.startsWith(
                        "images/"
                    )
            );


        updateStatus(
            scanId,
            {

                state:
                    "finished",

                step:
                    "Fertig",

                progress:
                    100,

                files,

                model:
                    "model.glb"
            }
        );


        console.log(
            "========================================"
        );

        console.log(
            "SCAN FERTIG:",
            scanId
        );

        console.log(
            "========================================"
        );


    } catch (
        error
    ) {

        console.error(
            "========================================"
        );

        console.error(
            "REKONSTRUKTION FEHLER"
        );

        console.error(
            error
        );

        console.error(
            "========================================"
        );


        updateStatus(
            scanId,
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


// ============================================================
// UPLOAD
// ============================================================

app.post(
    "/api/upload",
    (req, res, next) => {

        const scanId =
            crypto
                .randomBytes(8)
                .toString("hex");


        const scanDir =
            path.join(
                SCANS_DIR,
                scanId
            );


        const imagesDir =
            path.join(
                scanDir,
                "images"
            );


        fs.mkdirSync(
            imagesDir,
            {
                recursive:
                    true
            }
        );


        req.scanId =
            scanId;

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

                    return next(
                        error
                    );
                }


                try {

                    const photoCount =
                        req.files
                            ? req.files.length
                            : 0;


                    if (
                        photoCount < 2
                    ) {

                        return res
                            .status(400)
                            .json({

                                error:
                                    "Bitte mindestens 2 Fotos hochladen."
                            });
                    }


                    writeJSON(
                        path.join(
                            scanDir,
                            "settings.json"
                        ),
                        {

                            photos:
                                photoCount,

                            textureTarget:
                                30000,

                            textureMinimum:
                                10000,

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

                            state:
                                "queued",

                            step:
                                "Warte auf Verarbeitung",

                            progress:
                                0,

                            photos:
                                photoCount
                        }
                    );


                    res.json({

                        success:
                            true,

                        scanId,

                        photos:
                            photoCount
                    });


                    // Verarbeitung im Hintergrund starten
                    createModel(
                        scanId
                    );
                }


                catch (
                    error
                ) {

                    next(
                        error
                    );
                }
            }
        );
    }
);


// ============================================================
// STATUS
// ============================================================

app.get(
    "/api/status/:id",
    (req, res) => {

        const scanId =
            req.params.id;


        const file =
            getStatusFile(
                scanId
            );


        if (
            !fs.existsSync(
                file
            )
        ) {

            return res
                .status(404)
                .json({

                    error:
                        "Scan nicht gefunden."
                });
        }


        res.json(
            readJSON(
                file
            )
        );
    }
);


// ============================================================
// DOWNLOAD
// ============================================================

app.get(
    "/api/download/:id/{*file}",
    (req, res) => {

        const scanId =
            req.params.id;


        const requestedFile =
            req.params.file;


        if (
            !requestedFile
        ) {

            return res
                .status(400)
                .send(
                    "Datei fehlt."
                );
        }


        const scanDir =
            path.resolve(
                SCANS_DIR,
                scanId
            );


        const filePath =
            path.resolve(
                scanDir,
                requestedFile
            );


        // Schutz gegen ../
        if (
            !filePath.startsWith(
                scanDir +
                path.sep
            )
        ) {

            return res
                .status(403)
                .send(
                    "Zugriff verweigert."
                );
        }


        if (
            !fs.existsSync(
                filePath
            ) ||
            !fs.statSync(
                filePath
            ).isFile()
        ) {

            return res
                .status(404)
                .send(
                    "Datei nicht gefunden."
                );
        }


        res.download(
            filePath
        );
    }
);


// ============================================================
// SCAN-INFOS
// ============================================================

app.get(
    "/api/scan/:id",
    (req, res) => {

        const scanId =
            req.params.id;


        const scanDir =
            path.join(
                SCANS_DIR,
                scanId
            );


        if (
            !fs.existsSync(
                scanDir
            )
        ) {

            return res
                .status(404)
                .json({

                    error:
                        "Scan nicht gefunden."
                });
        }


        const settings =
            readJSON(
                path.join(
                    scanDir,
                    "settings.json"
                )
            );


        const status =
            readJSON(
                path.join(
                    scanDir,
                    "status.json"
                )
            );


        res.json({

            scanId,

            settings,

            status
        });
    }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok:
                true,

            colmap:
                COLMAP,

            assimp:
                ASSIMP,

            colmapExists:
                fs.existsSync(
                    COLMAP
                ),

            assimpExists:
                fs.existsSync(
                    ASSIMP
                ),

            node:
                process.version
        });
    }
);


// ============================================================
// FEHLER
// ============================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "SERVER FEHLER:"
        );

        console.error(
            error
        );


        res
            .status(500)
            .json({

                error:
                    error.message ||
                    "Unbekannter Serverfehler."
            });
    }
);


// ============================================================
// SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "       ULTRA 3D SCANNER SERVER"
        );
        console.log(
            "========================================"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "COLMAP:",
            COLMAP
        );

        console.log(
            "COLMAP vorhanden:",
            fs.existsSync(
                COLMAP
            )
        );

        console.log(
            "Assimp:",
            ASSIMP
        );

        console.log(
            "Assimp vorhanden:",
            fs.existsSync(
                ASSIMP
            )
        );

        console.log(
            "Node:",
            process.version
        );

        console.log(
            "========================================"
        );

        console.log("");
    }
);
