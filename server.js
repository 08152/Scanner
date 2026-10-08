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
    path.join(
        ALICEVISION_ROOT,
        "bin"
    );

const SENSOR_DATABASE =
    fs.existsSync(
        path.join(
            ALICEVISION_ROOT,
            "cameraSensors.db"
        )
    )
        ? path.join(
            ALICEVISION_ROOT,
            "cameraSensors.db"
        )
        : path.join(
            ALICEVISION_ROOT,
            "share",
            "aliceVision",
            "cameraSensors.db"
        );

const AV = {
    cameraInit:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_cameraInit"
        ),

    featureExtraction:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_featureExtraction"
        ),

    imageMatching:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_imageMatching"
        ),

    featureMatching:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_featureMatching"
        ),

    incrementalSfM:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_incrementalSfM"
        ),

    meshing:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_meshing"
        ),

    meshFiltering:
        path.join(
            ALICEVISION_BIN,
            "aliceVision_meshFiltering"
        ),

    texturing:
        path.join(
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

function exists(file) {
    try {
        return (
            fs.existsSync(file) &&
            fs.statSync(file).isFile()
        );
    } catch {
        return false;
    }
}

function requiredPrograms() {
    return {
        cameraInit:
            AV.cameraInit,

        featureExtraction:
            AV.featureExtraction,

        imageMatching:
            AV.imageMatching,

        featureMatching:
            AV.featureMatching,

        incrementalSfM:
            AV.incrementalSfM,

        meshing:
            AV.meshing,

        meshFiltering:
            AV.meshFiltering,

        texturing:
            AV.texturing
    };
}

function missingPrograms() {
    return Object.entries(
        requiredPrograms()
    )
        .filter(
            ([, file]) =>
                !exists(file)
        )
        .map(
            ([name]) =>
                name
        );
}

function run(command, args, cwd) {
    return new Promise(
        (resolve, reject) => {

            if (!exists(command)) {
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
                "START:"
            );
            console.log(command);
            console.log(
                "ARGUMENTE:"
            );
            console.log(
                args.join(" ")
            );
            console.log(
                "========================================"
            );

            let output = "";

            const child =
                spawn(
                    command,
                    args,
                    {
                        cwd,
                        env: {
                            ...process.env,

                            ALICEVISION_ROOT:
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
                    const text =
                        data.toString();

                    output += text;

                    process.stdout.write(
                        text
                    );
                }
            );

            child.stderr.on(
                "data",
                data => {
                    const text =
                        data.toString();

                    output += text;

                    process.stderr.write(
                        text
                    );
                }
            );

            child.on(
                "error",
                error => {
                    const message =
                        error.message +
                        "\n" +
                        output.slice(-12000);

                    reject(
                        new Error(message)
                    );
                }
            );

            child.on(
                "close",
                code => {

                    if (code === 0) {
                        resolve(
                            output
                        );
                        return;
                    }

                    reject(
                        new Error(
                            command +
                            " beendet mit Fehlercode " +
                            code +
                            "\n\n" +
                            output.slice(-12000)
                        )
                    );
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

function findFirstFile(
    directory,
    extensions
) {
    if (!fs.existsSync(directory)) {
        return null;
    }

    let found = null;

    function walk(current) {
        if (found) {
            return;
        }

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
            if (found) {
                break;
            }

            const full =
                path.join(
                    current,
                    entry.name
                );

            if (entry.isDirectory()) {
                walk(full);
            } else {
                const ext =
                    path.extname(
                        entry.name
                    ).toLowerCase();

                if (
                    extensions.includes(
                        ext
                    )
                ) {
                    found = full;
                }
            }
        }
    }

    walk(directory);

    return found;
}

async function textureWithFallback(
    root,
    sfmFile,
    meshFile,
    textureDir
) {
    const sizes = [
        32768,
        16384,
        8192
    ];

    let lastError = null;

    for (
        const size of sizes
    ) {
        try {
            if (
                fs.existsSync(
                    textureDir
                )
            ) {
                fs.rmSync(
                    textureDir,
                    {
                        recursive: true,
                        force: true
                    }
                );
            }

            fs.mkdirSync(
                textureDir,
                {
                    recursive: true
                }
            );

            await run(
                AV.texturing,
                [
                    "--input",
                    sfmFile,

                    "--inputMesh",
                    meshFile,

                    "--output",
                    textureDir,

                    "--textureSide",
                    String(size),

                    "--outputTextureFileType",
                    "png",

                    "--unwrapMethod",
                    "Basic",

                    "--useUDIM",
                    "True",

                    "--fillHoles",
                    "False",

                    "--padding",
                    "5",

                    "--useScore",
                    "True",

                    "--bestScoreThreshold",
                    "0.1",

                    "--angleHardThreshold",
                    "90",

                    "--correctEV",
                    "False",

                    "--forceVisibleByAllVertices",
                    "False",

                    "--visibilityRemappingMethod",
                    "PullPush",

                    "--subdivisionTargetRatio",
                    "0",

                    "--verboseLevel",
                    "info"
                ],
                root
            );

            const texturedMesh =
                findFirstFile(
                    textureDir,
                    [
                        ".obj",
                        ".gltf",
                        ".glb"
                    ]
                );

            if (
                texturedMesh ||
                findFirstFile(
                    textureDir,
                    [".png"]
                )
            ) {
                return {
                    success: true,
                    size
                };
            }

            throw new Error(
                "Texturing hat keine Ausgabedateien erzeugt."
            );

        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ||
        new Error(
            "Texturierung fehlgeschlagen."
        );
}

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

    const cameraInitFile =
        path.join(
            camera,
            "cameraInit.sfm"
        );

    const sfmFile =
        path.join(
            sfm,
            "sfm.abc"
        );

    const meshFile =
        path.join(
            mesh,
            "mesh.obj"
        );

    const filteredMesh =
        path.join(
            mesh,
            "filtered.obj"
        );

    try {

        const missing =
            missingPrograms();

        if (missing.length > 0) {
            throw new Error(
                "AliceVision-Programme fehlen: " +
                missing.join(", ")
            );
        }

        if (
            !fs.existsSync(
                SENSOR_DATABASE
            )
        ) {
            throw new Error(
                "cameraSensors.db nicht gefunden: " +
                SENSOR_DATABASE
            );
        }

        const imageFiles =
            findFiles(images)
                .filter(
                    file => {
                        const ext =
                            path.extname(
                                file
                            ).toLowerCase();

                        return [
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".webp"
                        ].includes(ext);
                    }
                );

        if (
            imageFiles.length < 2
        ) {
            throw new Error(
                "Zu wenige Bilder."
            );
        }

        fs.mkdirSync(
            camera,
            {
                recursive: true
            }
        );

        fs.mkdirSync(
            features,
            {
                recursive: true
            }
        );

        fs.mkdirSync(
            matches,
            {
                recursive: true
            }
        );

        fs.mkdirSync(
            sfm,
            {
                recursive: true
            }
        );

        fs.mkdirSync(
            mesh,
            {
                recursive: true
            }
        );

        updateStatus(
            id,
            {
                state:
                    "processing",
                step:
                    "Kameras erkennen",
                progress:
                    5
            }
        );

        await run(
            AV.cameraInit,
            [
                "--imageFolder",
                images,

                "--sensorDatabase",
                SENSOR_DATABASE,

                "--defaultFieldOfView",
                "45",

                "--groupCameraFallback",
                "folder",

                "--viewIdMethod",
                "filename",

                "--viewIdRegex",
                ".*?(\\d+)",

                "--allowSingleView",
                "1",

                "--verboseLevel",
                "info",

                "--output",
                cameraInitFile
            ],
            root
        );

        if (
            !fs.existsSync(
                cameraInitFile
            )
        ) {
            throw new Error(
                "cameraInit.sfm wurde nicht erzeugt."
            );
        }

        updateStatus(
            id,
            {
                step:
                    "Bildmerkmale berechnen",
                progress:
                    18
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

                "--maxThreads",
                "0",

                "--verboseLevel",
                "info",

                "--output",
                features
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "Bilder vergleichen",
                progress:
                    30
            }
        );

        await run(
            AV.imageMatching,
            [
                "--input",
                cameraInitFile,

                "--featuresFolders",
                features,

                "--method",
                "Exhaustive",

                "--maxDescriptors",
                "0",

                "--nbMatches",
                "0",

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

        const imageMatches =
            path.join(
                matches,
                "imageMatches.txt"
            );

        if (
            !fs.existsSync(
                imageMatches
            )
        ) {
            throw new Error(
                "imageMatches.txt wurde nicht erzeugt."
            );
        }

        updateStatus(
            id,
            {
                step:
                    "Merkmale abgleichen",
                progress:
                    40
            }
        );

        await run(
            AV.featureMatching,
            [
                "--input",
                cameraInitFile,

                "--featuresFolders",
                features,

                "--imagePairsList",
                imageMatches,

                "--describerTypes",
                "sift",

                "--photometricMatchingMethod",
                "ANN_L2",

                "--geometricEstimator",
                "acransac",

                "--geometricFilterType",
                "fundamental_matrix",

                "--distanceRatio",
                "0.8",

                "--maxIteration",
                "2048",

                "--geometricError",
                "0.0",

                "--maxMatches",
                "0",

                "--savePutativeMatches",
                "False",

                "--guidedMatching",
                "False",

                "--exportDebugFiles",
                "False",

                "--verboseLevel",
                "info",

                "--output",
                matches
            ],
            root
        );

        updateStatus(
            id,
            {
                step:
                    "3D-Kamera-Positionen berechnen",
                progress:
                    52
            }
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

                "--computeStructureColor",
                "True",

                "--useAutoTransform",
                "True",

                "--minNumberOfObservationsForTriangulation",
                "2",

                "--maxNumberOfMatches",
                "0",

                "--minNumberOfMatches",
                "0",

                "--output",
                sfmFile,

                "--outputViewsAndPoses",
                path.join(
                    sfm,
                    "cameras.sfm"
                ),

                "--extraInfoFolder",
                sfm,

                "--verboseLevel",
                "info"
            ],
            root
        );

        if (
            !fs.existsSync(
                sfmFile
            )
        ) {
            throw new Error(
                "sfm.abc wurde nicht erzeugt."
            );
        }

        updateStatus(
            id,
            {
                step:
                    "CPU-3D-Mesh erstellen",
                progress:
                    70
            }
        );

        await run(
            AV.meshing,
            [
                "--input",
                sfmFile,

                "--estimateSpaceFromSfM",
                "True",

                "--estimateSpaceMinObservations",
                "2",

                "--estimateSpaceMinObservationAngle",
                "5",

                "--maxInputPoints",
                "50000000",

                "--maxPoints",
                "10000000",

                "--maxPointsPerVoxel",
                "1000000",

                "--minStep",
                "1",

                "--partitioning",
                "singleBlock",

                "--repartition",
                "multiResolution",

                "--angleFactor",
                "15",

                "--simFactor",
                "15",

                "--pixSizeMarginInitCoef",
                "2",

                "--pixSizeMarginFinalCoef",
                "4",

                "--voteMarginFactor",
                "4",

                "--contributeMarginFactor",
                "2",

                "--simGaussianSizeInit",
                "10",

                "--simGaussianSize",
                "10",

                "--minAngleThreshold",
                "1",

                "--refineFuse",
                "True",

                "--addLandmarksToTheDensePointCloud",
                "True",

                "--colorizeOutput",
                "True",

                "--saveRawDensePointCloud",
                "False",

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

        if (
            !fs.existsSync(
                meshFile
            )
        ) {
            throw new Error(
                "mesh.obj wurde nicht erzeugt."
            );
        }

        updateStatus(
            id,
            {
                step:
                    "Mesh verbessern",
                progress:
                    82
            }
        );

        try {
            await run(
                AV.meshFiltering,
                [
                    "--inputMesh",
                    meshFile,

                    "--keepLargestMeshOnly",
                    "False",

                    "--smoothingSubset",
                    "all",

                    "--smoothingBoundariesNeighbours",
                    "0",

                    "--smoothingIterations",
                    "3",

                    "--smoothingLambda",
                    "1",

                    "--filteringSubset",
                    "all",

                    "--filteringIterations",
                    "1",

                    "--filterLargeTrianglesFactor",
                    "60",

                    "--filterTrianglesRatio",
                    "0",

                    "--verboseLevel",
                    "info",

                    "--outputMesh",
                    filteredMesh
                ],
                root
            );
        } catch {
            fs.copyFileSync(
                meshFile,
                filteredMesh
            );
        }

        if (
            !fs.existsSync(
                filteredMesh
            )
        ) {
            throw new Error(
                "Kein fertiges Mesh vorhanden."
            );
        }

        updateStatus(
            id,
            {
                step:
                    "Fototextur erstellen",
                progress:
                    92
            }
        );

        const textureResult =
            await textureWithFallback(
                root,
                path.join(
                    mesh,
                    "densePointCloud.abc"
                ),
                filteredMesh,
                texture
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

                files,

                mesh:
                    path.relative(
                        root,
                        filteredMesh
                    ),

                texture:
                    path.relative(
                        root,
                        texture
                    ),

                textureResolution:
                    textureResult.size
            }
        );

    } catch (error) {

        console.error(
            "========================================"
        );

        console.error(
            "SCAN FEHLER"
        );

        console.error(
            error
        );

        console.error(
            "========================================"
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
                    String(
                        Date.now()
                    ) +
                    "-" +
                    crypto
                        .randomBytes(6)
                        .toString(
                            "hex"
                        ) +
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
            files:
                100,

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

app.post(
    "/api/upload",
    (req, res, next) => {

        const id =
            crypto
                .randomBytes(8)
                .toString(
                    "hex"
                );

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

                        textureFallbacks:
                            [
                                32768,
                                16384,
                                8192
                            ],

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

        if (
            !fs.existsSync(file)
        ) {
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

        if (
            !fs.existsSync(root)
        ) {
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
                root +
                path.sep
            )
        ) {
            res.status(403).send(
                "Zugriff verweigert."
            );
            return;
        }

        if (
            !fs.existsSync(
                filePath
            ) ||
            !fs.statSync(
                filePath
            ).isFile()
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
            of Object.entries(
                requiredPrograms()
            )
        ) {
            programs[name] = {
                path:
                    file,

                exists:
                    exists(file)
            };
        }

        res.json({
            ok:
                true,

            node:
                process.version,

            aliceVisionRoot:
                ALICEVISION_ROOT,

            sensorDatabase:
                SENSOR_DATABASE,

            sensorDatabaseExists:
                fs.existsSync(
                    SENSOR_DATABASE
                ),

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
            "SENSOR DATABASE:",
            SENSOR_DATABASE
        );

        console.log(
            "========================================"
        );
    }
);
