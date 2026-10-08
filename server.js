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
        const id = req.scanId;
        const dir = path.join(ROOT, id, "images");

        fs.mkdirSync(dir, { recursive: true });

        cb(null, dir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();

        cb(
            null,
            `${String(Date.now())}-${crypto.randomBytes(4).toString("hex")}${ext}`
        );
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
            return cb(new Error("Nur JPG, PNG und WebP sind erlaubt."));
        }

        cb(null, true);
    }
});


function saveStatus(id, status, message, extra = {}) {
    const file = path.join(ROOT, id, "status.json");

    fs.writeFileSync(
        file,
        JSON.stringify(
            {
                id,
                status,
                message,
                updated: new Date().toISOString(),
                ...extra
            },
            null,
            2
        )
    );
}


function runCommand(command, args, cwd, id) {
    return new Promise((resolve, reject) => {

        console.log("\nRUN:", command, args.join(" "));

        const process = spawn(command, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"]
        });

        let output = "";

        process.stdout.on("data", data => {
            const text = data.toString();

            output += text;

            console.log(text);
        });

        process.stderr.on("data", data => {
            const text = data.toString();

            output += text;

            console.log(text);
        });

        process.on("error", error => {
            reject(error);
        });

        process.on("close", code => {

            if (code === 0) {
                resolve(output);
            } else {
                reject(
                    new Error(
                        `${command} beendet mit Code ${code}`
                    )
                );
            }
        });
    });
}


async function createModel(id) {

    const scan = path.join(ROOT, id);

    const images = path.join(scan, "images");
    const database = path.join(scan, "database.db");

    const sparse = path.join(scan, "sparse");
    const dense = path.join(scan, "dense");

    try {

        saveStatus(
            id,
            "processing",
            "Bilder werden analysiert..."
        );


        /*
         * 1. Feature Extraction
         */

        await runCommand(
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
            scan,
            id
        );


        /*
         * 2. Bilder miteinander vergleichen
         */

        saveStatus(
            id,
            "processing",
            "Kamerapositionen werden berechnet..."
        );

        await runCommand(
            "colmap",
            [
                "exhaustive_matcher",

                "--database_path",
                database,

                "--FeatureMatching.use_gpu",
                "0"
            ],
            scan,
            id
        );


        /*
         * 3. Sparse Reconstruction
         */

        fs.mkdirSync(sparse, {
            recursive: true
        });

        await runCommand(
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
            scan,
            id
        );


        const sparseModel = path.join(
            sparse,
            "0"
        );

        if (!fs.existsSync(sparseModel)) {
            throw new Error(
                "COLMAP konnte kein zusammenhängendes 3D-Modell aus den Bildern erstellen."
            );
        }


        /*
         * 4. Dense Reconstruction
         */

        saveStatus(
            id,
            "processing",
            "Hochauflösende 3D-Geometrie wird berechnet..."
        );

        fs.mkdirSync(dense, {
            recursive: true
        });

        await runCommand(
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
                 * Für Render zunächst moderat.
                 * Später können wir diesen Wert erhöhen.
                 */
                "--max_image_size",
                "3000"
            ],
            scan,
            id
        );


        /*
         * 5. Dense Stereo
         */

        await runCommand(
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
            scan,
            id
        );


        /*
         * 6. Point Cloud
         */

        const fused = path.join(
            dense,
            "fused.ply"
        );

        await runCommand(
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
            scan,
            id
        );


        /*
         * 7. Mesh
         */

        saveStatus(
            id,
            "processing",
            "3D-Oberfläche wird erzeugt..."
        );

        const mesh = path.join(
            dense,
            "meshed-poisson.ply"
        );

        await runCommand(
            "colmap",
            [
                "poisson_mesher",

                "--input_path",
                fused,

                "--output_path",
                mesh
            ],
            scan,
            id
        );


        /*
         * 8. Textur
         */

        saveStatus(
            id,
            "processing",
            "Oberfläche wird texturiert..."
        );

        const textured = path.join(
            dense,
            "textured"
        );

        fs.mkdirSync(textured, {
            recursive: true
        });

        await runCommand(
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
            scan,
            id
        );


        /*
         * 9. Ergebnisse suchen
         */

        const files = [];

        function collectFiles(dir) {

            if (!fs.existsSync(dir)) {
                return;
            }

            for (const file of fs.readdirSync(dir)) {

                const full = path.join(dir, file);
                const stat = fs.statSync(full);

                if (stat.isDirectory()) {
                    collectFiles(full);
                } else {
                    files.push(
                        path.relative(scan, full)
                    );
                }
            }
        }

        collectFiles(textured);


        /*
         * 10. Fertig
         */

        saveStatus(
            id,
            "finished",
            "3D-Modell wurde erfolgreich erstellt.",
            {
                files
            }
        );

        console.log(
            `SCAN ${id} FERTIG`
        );

    } catch (error) {

        console.error(error);

        saveStatus(
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

        req.scanId = crypto.randomUUID();

        next();
    },

    upload.array("photos", 100),

    async (req, res) => {

        const id = req.scanId;

        const scan = path.join(
            ROOT,
            id
        );

        fs.mkdirSync(scan, {
            recursive: true
        });

        fs.writeFileSync(
            path.join(scan, "settings.json"),

            JSON.stringify(
                {
                    textureTarget: 30000,
                    textureMinimum: 10000,
                    maximumTriangles: 750000000,
                    photos: req.files.length
                },
                null,
                2
            )
        );

        saveStatus(
            id,
            "queued",
            "Fotos hochgeladen. 3D-Berechnung wird gestartet."
        );

        res.json({
            success: true,
            scanId: id,
            message: "3D-Berechnung gestartet."
        });

        /*
         * Wichtig:
         * Nicht auf die Berechnung warten.
         * Render kann währenddessen weiterlaufen.
         */

        setImmediate(() => {
            createModel(id);
        });
    }
);


/*
 * Status
 */

app.get(
    "/api/status/:id",
    (req, res) => {

        const id = req.params.id;

        const file = path.join(
            ROOT,
            id,
            "status.json"
        );

        if (!fs.existsSync(file)) {

            return res.status(404).json({
                error: "Scan nicht gefunden."
            });
        }

        const status = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        res.json(status);
    }
);


/*
 * Download
 */

app.get(
    "/api/download/:id/*file",
    (req, res) => {

        const id = req.params.id;

        const requested =
            req.params.file;

        const scan = path.join(
            ROOT,
            id
        );

        const file = path.resolve(
            scan,
            requested
        );

        if (
            !file.startsWith(
                path.resolve(scan) +
                path.sep
            )
        ) {
            return res.status(403).send(
                "Nicht erlaubt."
            );
        }

        if (!fs.existsSync(file)) {
            return res.status(404).send(
                "Datei nicht gefunden."
            );
        }

        res.download(file);
    }
);


/*
 * Fehlerbehandlung
 */

app.use((error, req, res, next) => {

    console.error(error);

    res.status(500).json({
        error: error.message
    });
});


app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `3D Scanner läuft auf Port ${PORT}`
        );
    }
);
