const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const SCANS = path.join(ROOT, "scans");

if (!fs.existsSync(SCANS)) {
    fs.mkdirSync(SCANS, { recursive: true });
}

app.use(express.static(ROOT));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const id = req.scanId;

        const folder = path.join(
            SCANS,
            id,
            "images"
        );

        fs.mkdirSync(folder, { recursive: true });

        cb(null, folder);
    },

    filename: (req, file, cb) => {
        const extension =
            path.extname(file.originalname).toLowerCase();

        cb(
            null,
            crypto.randomUUID() + extension
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
            ".jpg",
            ".jpeg",
            ".png",
            ".webp"
        ];

        const ext =
            path.extname(file.originalname)
                .toLowerCase();

        if (!allowed.includes(ext)) {
            return cb(
                new Error("Nur JPG, PNG und WEBP sind erlaubt.")
            );
        }

        cb(null, true);
    }
});

app.post(
    "/api/scan",

    (req, res, next) => {
        req.scanId = crypto.randomUUID();
        next();
    },

    upload.array("photos", 100),

    async (req, res) => {

        try {

            if (!req.files || req.files.length < 3) {
                return res.status(400).json({
                    error: "Mindestens 3 Fotos werden benötigt."
                });
            }

            const scanId = req.scanId;

            const scanFolder =
                path.join(SCANS, scanId);

            const imagesFolder =
                path.join(scanFolder, "images");

            const resultFolder =
                path.join(scanFolder, "result");

            fs.mkdirSync(resultFolder, {
                recursive: true
            });

            const settings = {
                textureResolution: 30000,
                minimumTextureResolution: 10000,
                maximumTriangles: 750000000,
                photos: req.files.length,
                created: new Date().toISOString()
            };

            fs.writeFileSync(
                path.join(scanFolder, "settings.json"),
                JSON.stringify(settings, null, 2)
            );

            console.log("");
            console.log("=================================");
            console.log("NEUER 3D-SCAN");
            console.log("=================================");
            console.log("Scan:", scanId);
            console.log("Fotos:", req.files.length);
            console.log("Texturziel: 30K");
            console.log("Min. Textur: 10K");
            console.log("Meshziel: 750 Mio. Dreiecke");
            console.log("=================================");

            /*
             * Hier wird später die eigentliche
             * Photogrammetrie-Engine gestartet.
             *
             * Der Server versucht zunächst,
             * COLMAP zu finden.
             */

            startColmap(
                scanFolder,
                imagesFolder,
                resultFolder
            );

            res.json({
                success: true,
                scanId,
                photos: req.files.length,
                settings
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: error.message
            });
        }
    }
);

function startColmap(
    scanFolder,
    imagesFolder,
    resultFolder
) {

    console.log("Starte COLMAP...");

    const args = [
        "automatic_reconstructor",

        "--workspace_path",
        scanFolder,

        "--image_path",
        imagesFolder,

        "--quality",
        "extreme",

        "--data_type",
        "individual"
    ];

    const process = spawn(
        "colmap",
        args,
        {
            shell: false
        }
    );

    process.stdout.on(
        "data",
        data => {
            console.log(
                "[COLMAP]",
                data.toString()
            );
        }
    );

    process.stderr.on(
        "data",
        data => {
            console.error(
                "[COLMAP]",
                data.toString()
            );
        }
    );

    process.on(
        "error",
        error => {

            console.log(
                "COLMAP konnte nicht gestartet werden."
            );

            console.log(
                "Die Upload-Funktion funktioniert trotzdem."
            );

            console.log(
                "Später wird die Engine direkt in den Server eingebaut."
            );
        }
    );

    process.on(
        "close",
        code => {

            console.log(
                "COLMAP beendet. Code:",
                code
            );

            /*
             * Hier kommt anschließend:
             *
             * Dense Reconstruction
             * Mesh-Erzeugung
             * Texturierung
             * 30K-Textur
             * GLB/OBJ/STL-Export
             */
        }
    );
}

app.get(
    "/api/status/:id",
    (req, res) => {

        const folder =
            path.join(
                SCANS,
                req.params.id
            );

        if (!fs.existsSync(folder)) {
            return res.status(404).json({
                error: "Scan nicht gefunden."
            });
        }

        res.json({
            scanId: req.params.id,
            exists: true
        });
    }
);

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log("=================================");
        console.log("ULTRA 3D SCANNER");
        console.log("=================================");
        console.log(
            `Server läuft auf Port ${PORT}`
        );
        console.log(
            "Max. Fotos: 100"
        );
        console.log(
            "Texturziel: 30K"
        );
        console.log(
            "Meshziel: 750.000.000 Dreiecke"
        );
        console.log("=================================");
    }
);
