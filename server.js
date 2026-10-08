const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const SCANS = path.join(ROOT, "scans");

fs.mkdirSync(SCANS, { recursive: true });

app.use(express.static(ROOT));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = path.join(
            SCANS,
            req.scanId,
            "images"
        );

        fs.mkdirSync(folder, { recursive: true });
        cb(null, folder);
    },

    filename: (req, file, cb) => {
        const ext =
            path.extname(file.originalname).toLowerCase();

        cb(
            null,
            crypto.randomUUID() + ext
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
                new Error(
                    "Nur JPG, JPEG, PNG und WEBP sind erlaubt."
                )
            );
        }

        cb(null, true);
    }
});


/*
    SCAN STARTEN
*/

app.post(
    "/api/scan",

    (req, res, next) => {
        req.scanId = crypto.randomUUID();
        next();
    },

    upload.array("photos", 100),

    (req, res) => {

        try {

            if (
                !req.files ||
                req.files.length < 3
            ) {
                return res.status(400).json({
                    error:
                        "Mindestens 3 Fotos erforderlich."
                });
            }

            const id = req.scanId;

            const folder =
                path.join(SCANS, id);

            const result =
                path.join(folder, "result");

            fs.mkdirSync(
                result,
                { recursive: true }
            );

            const settings = {
                photos: req.files.length,

                minimumTexture:
                    10000,

                targetTexture:
                    30000,

                maximumTriangles:
                    750000000
            };

            fs.writeFileSync(
                path.join(
                    folder,
                    "settings.json"
                ),
                JSON.stringify(
                    settings,
                    null,
                    2
                )
            );

            /*
                Hier wird später die
                Photogrammetrie-Engine gestartet.
            */

            res.json({
                success: true,
                scanId: id,
                photos: req.files.length,

                message:
                    "Fotos erfolgreich hochgeladen."
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: error.message
            });
        }
    }
);


/*
    STATUS
*/

app.get(
    "/api/status/:id",
    (req, res) => {

        const folder =
            path.join(
                SCANS,
                req.params.id
            );

        const result =
            path.join(
                folder,
                "result"
            );

        if (!fs.existsSync(folder)) {
            return res.status(404).json({
                error: "Scan nicht gefunden."
            });
        }

        const files =
            fs.existsSync(result)
                ? fs.readdirSync(result)
                : [];

        const downloads = files.filter(
            file => {

                const ext =
                    path.extname(file)
                        .toLowerCase();

                return [
                    ".glb",
                    ".gltf",
                    ".obj",
                    ".mtl",
                    ".stl",
                    ".ply",
                    ".fbx",
                    ".jpg",
                    ".jpeg",
                    ".png"
                ].includes(ext);
            }
        );

        res.json({
            scanId: req.params.id,
            files: downloads
        });
    }
);


/*
    DOWNLOAD
*/

app.get(
    "/api/download/:id/:file",
    (req, res) => {

        const id =
            req.params.id;

        const file =
            path.basename(
                req.params.file
            );

        const filePath =
            path.join(
                SCANS,
                id,
                "result",
                file
            );

        if (!fs.existsSync(filePath)) {
            return res.status(404).send(
                "Datei wurde noch nicht erstellt."
            );
        }

        res.download(
            filePath,
            file
        );
    }
);


/*
    SERVER
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "=============================="
        );

        console.log(
            "ULTRA 3D SCANNER"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Textur: bis 30K"
        );

        console.log(
            "Mesh: bis 750 Mio. Dreiecke"
        );

        console.log(
            "Export: GLB / OBJ / STL"
        );

        console.log(
            "=============================="
        );

    }
);
