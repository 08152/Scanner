const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 10000;
const ROOT = path.join(__dirname, "scans");

fs.mkdirSync(ROOT, { recursive: true });

app.use(express.static(__dirname));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(
            ROOT,
            req.scanId,
            "images"
        );

        fs.mkdirSync(dir, {
            recursive: true
        });

        cb(null, dir);
    },

    filename: (req, file, cb) => {
        const ext =
            path.extname(file.originalname)
                .toLowerCase();

        const name =
            Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            ext;

        cb(null, name);
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
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(
                new Error(
                    "Nur JPG, PNG und WebP sind erlaubt."
                )
            );
        }

        cb(null, true);
    }
});


function writeStatus(
    id,
    status,
    message,
    extra = {}
) {
    const file =
        path.join(
            ROOT,
            id,
            "status.json"
        );

    fs.writeFileSync(
        file,
        JSON.stringify(
            {
                id,
                status,
                message,
                updated:
                    new Date().toISOString(),
                ...extra
            },
            null,
            2
        )
    );
}


function run(command, args, cwd) {
    return new Promise(
        (resolve, reject) => {

            console.log(
                "\n$",
                command,
                args.join(" ")
            );

            const child =
                spawn(
                    command,
                    args,
                    {
                        cwd,
                        env: {
                            ...process.env,
                            QT_QPA_PLATFORM:
                                "offscreen"
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
                reject
            );

            child.on(
                "close",
                code => {

                    if (code === 0) {
                        resolve();
                    } else {
                        reject(
                            new Error(
                                `${command} beendet mit Code ${code}`
                            )
                        );
                    }
                }
            );
        }
    );
}


function collectFiles(
    directory,
    base,
    output
) {
    if (!fs.existsSync(directory)) {
        return;
    }

    for (
        const name of fs.readdirSync(directory)
    ) {

        const full =
            path.join(
                directory,
                name
            );

        const stat =
            fs.statSync(full);

        if (stat.isDirectory()) {

            collectFiles(
                full,
                base,
                output
            );

        } else {

            output.push(
                path.relative(
                    base,
                    full
                )
            );
        }
    }
}


async function createModel(id) {

    const scan =
        path.join(
            ROOT,
            id
        );

    const images =
        path.join(
            scan,
            "images"
        );

    const database =
        path.join(
            scan,
            "database.db"
        );

    const sparse =
        path.join(
            scan,
            "sparse"
        );

    const dense =
        path.join(
            scan,
            "dense"
        );

    try {

        /*
         * 1
         * Merkmale aus Bildern
         */

        writeStatus(
            id,
            "processing",
            "Bilder werden analysiert..."
        );

        await run(
            "colmap",
            [
                "feature_extractor",

                "--database_path",
                database,

                "--image_path",
                images,

                "--FeatureExtraction.use_gpu",
                "0",

                "--SiftExtraction.max_num_features",
                "8192"
            ],
            scan
        );


        /*
         * 2
         * Bildpaare vergleichen
         */

        writeStatus(
            id,
            "processing",
            "Fotos werden miteinander verglichen..."
        );

        await run(
            "colmap",
            [
                "exhaustive_matcher",

                "--database_path",
                database,

                "--FeatureMatching.use_gpu",
                "0"
            ],
            scan
        );


        /*
         * 3
         * Kameras + Sparse-Modell
         */

        writeStatus(
            id,
            "processing",
            "Kamerapositionen werden berechnet..."
        );

        fs.mkdirSync(
            sparse,
            {
                recursive: true
            }
        );

        await run(
            "colmap",
            [
                "mapper",

                "--database_path",
                database,

                "--image_path",
                images,

                "--output_path",
                sparse
            ],
            scan
        );


        const sparseModel =
            path.join(
                sparse,
                "0"
            );

        if (
            !fs.existsSync(
                sparseModel
            )
        ) {
            throw new Error(
                "Kein zusammenhängendes 3D-Modell gefunden. Bitte mehr Fotos mit deutlicher Überlappung verwenden."
            );
        }


        /*
         * 4
         * Bilder für Dense Reconstruction
         */

        writeStatus(
            id,
            "processing",
            "Hochauflösende Geometrie wird vorbereitet..."
        );

        fs.mkdirSync(
            dense,
            {
                recursive: true
            }
        );

        await run(
            "colmap",
            [
                "image_undistorter",

                "--image_path",
                images,

                "--input_path",
                sparseModel,

                "--output_path",
                dense,

                "--output_type",
                "COLMAP",

                /*
                 * Render-freundlicher Startwert.
                 * Später können wir diesen erhöhen.
                 */
                "--max_image_size",
                "3000"
            ],
            scan
        );


        /*
         * 5
         * Dense Stereo
         */

        writeStatus(
            id,
            "processing",
            "Dichte 3D-Geometrie wird berechnet..."
        );

        await run(
            "colmap",
            [
                "patch_match_stereo",

                "--workspace_path",
                dense,

                "--workspace_format",
                "COLMAP",

                "--PatchMatchStereo.geom_consistency",
                "true"
            ],
            scan
        );


        /*
         * 6
         * Point Cloud
         */

        writeStatus(
            id,
            "processing",
            "3D-Punktwolke wird erzeugt..."
        );

        const fused =
            path.join(
                dense,
                "fused.ply"
            );

        await run(
            "colmap",
            [
                "stereo_fusion",

                "--workspace_path",
                dense,

                "--workspace_format",
                "COLMAP",

                "--input_type",
                "geometric",

                "--output_path",
                fused
            ],
            scan
        );


        /*
         * 7
         * Mesh
         */

        writeStatus(
            id,
            "processing",
            "3D-Oberfläche wird erzeugt..."
        );

        const mesh =
            path.join(
                dense,
                "meshed-poisson.ply"
            );

        await run(
            "colmap",
            [
                "poisson_mesher",

                "--input_path",
                fused,

                "--output_path",
                mesh
            ],
            scan
        );


        if (
            !fs.existsSync(mesh)
        ) {
            throw new Error(
                "COLMAP konnte kein Mesh erzeugen."
            );
        }


        /*
         * 8
         * Textur + UV
         */

        writeStatus(
            id,
            "processing",
            "Textur und UV-Koordinaten werden erzeugt..."
        );

        const textured =
            path.join(
                dense,
                "textured"
            );

        fs.mkdirSync(
            textured,
            {
                recursive: true
            }
        );

        await run(
            "colmap",
            [
                "mesh_texturer",

                "--workspace_path",
                dense,

                "--input_path",
                mesh,

                "--output_path",
                textured
            ],
            scan
        );


        /*
         * COLMAP erzeugt normalerweise:
         *
         * textured/mesh.ply
         * textured/texture.png
         */

        const texturedMesh =
            path.join(
                textured,
                "mesh.ply"
            );

        const texture =
            path.join(
                textured,
                "texture.png"
            );


        if (
            !fs.existsSync(
                texturedMesh
            )
        ) {
            throw new Error(
                "Das texturierte Mesh wurde nicht erzeugt."
            );
        }


        /*
         * 9
         * GLB erzeugen
         */

        writeStatus(
            id,
            "processing",
            "Browser-Modell wird erstellt..."
        );

        const glb =
            path.join(
                scan,
                "model.glb"
            );


        /*
         * Assimp verwendet die
         * Textur-Datei neben dem Mesh.
         */

        if (
            fs.existsSync(texture)
        ) {

            await run(
                "assimp",
                [
                    "export",

                    texturedMesh,

                    glb,

                    "-f",
                    "glb2"
                ],
                textured
            );

        } else {

            await run(
                "assimp",
                [
                    "export",

                    texturedMesh,

                    glb,

                    "-f",
                    "glb2"
                ],
                scan
            );
        }


        if (
            !fs.existsSync(glb)
        ) {
            throw new Error(
                "GLB konnte nicht erzeugt werden."
            );
        }


        /*
         * 10
         * Dateien sammeln
         */

        const files = [];

        collectFiles(
            textured,
            scan,
            files
        );


        if (
            fs.existsSync(glb)
        ) {
            files.push(
                "model.glb"
            );
        }


        writeStatus(
            id,
            "finished",
            "3D-Modell fertig.",
            {
                files
            }
        );

        console.log(
            `SCAN ${id} FERTIG`
        );

    } catch (error) {

        console.error(
            error
        );

        writeStatus(
            id,
            "error",
            error.message
        );
    }
}


/*
 * Upload
 */

app.post(
    "/api/scan",

    (req, res, next) => {

        req.scanId =
            crypto.randomUUID();

        next();
    },

    upload.array(
        "photos",
        100
    ),

    (req, res) => {

        const id =
            req.scanId;

        const scan =
            path.join(
                ROOT,
                id
            );

        fs.mkdirSync(
            scan,
            {
                recursive: true
            }
        );


        if (
            !req.files ||
            req.files.length < 3
        ) {

            return res.status(400).json({
                error:
                    "Mindestens 3 Fotos werden benötigt."
            });
        }


        fs.writeFileSync(
            path.join(
                scan,
                "settings.json"
            ),

            JSON.stringify(
                {
                    photos:
                        req.files.length,

                    textureTarget:
                        30000,

                    textureMinimum:
                        10000,

                    maximumTriangles:
                        750000000,

                    created:
                        new Date().toISOString()
                },
                null,
                2
            )
        );


        writeStatus(
            id,
            "queued",
            "Upload abgeschlossen."
        );


        res.json({
            success: true,
            scanId: id
        });


        /*
         * Rekonstruktion im Hintergrund.
         */

        setImmediate(
            () => {
                createModel(id);
            }
        );
    }
);


/*
 * Status
 */

app.get(
    "/api/status/:id",
    (req, res) => {

        const file =
            path.join(
                ROOT,
                req.params.id,
                "status.json"
            );

        if (
            !fs.existsSync(file)
        ) {

            return res.status(404).json({
                error:
                    "Scan nicht gefunden."
            });
        }


        res.json(
            JSON.parse(
                fs.readFileSync(
                    file,
                    "utf8"
                )
            )
        );
    }
);


/*
 * Download
 */

app.get(
    "/api/download/:id/*file",
    (req, res) => {

        const id =
            req.params.id;

        const requested =
            req.params.file;

        const scan =
            path.resolve(
                ROOT,
                id
            );

        const file =
            path.resolve(
                scan,
                requested
            );


        if (
            !file.startsWith(
                scan + path.sep
            )
        ) {
            return res.status(403).send(
                "Nicht erlaubt."
            );
        }


        if (
            !fs.existsSync(file)
        ) {
            return res.status(404).send(
                "Datei nicht gefunden."
            );
        }


        res.download(file);
    }
);


/*
 * Fehler
 */

app.use(
    (error, req, res, next) => {

        console.error(error);

        if (
            res.headersSent
        ) {
            return next(error);
        }

        res.status(500).json({
            error:
                error.message ||
                "Unbekannter Fehler."
        });
    }
);


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `3D Scanner läuft auf Port ${PORT}`
        );
    }
);
