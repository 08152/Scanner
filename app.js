import {
    createSession
} from "https://cdn.jsdelivr.net/gh/arrival-space/splat.js@main/src/index.js";

const canvas =
    document.getElementById("canvas");

const photoInput =
    document.getElementById("photos");

const dropZone =
    document.getElementById("dropZone");

const quality =
    document.getElementById("quality");

const startButton =
    document.getElementById("startButton");

const pauseButton =
    document.getElementById("pauseButton");

const finishButton =
    document.getElementById("finishButton");

const downloadButton =
    document.getElementById("downloadButton");

const statusElement =
    document.getElementById("status");

const progressBar =
    document.getElementById("progressBar");

const progressText =
    document.getElementById("progressText");

const filesText =
    document.getElementById("filesText");

const logElement =
    document.getElementById("log");

let files = [];
let session = null;
let exportedBlob = null;
let running = false;

function log(message) {
    const line =
        "[" +
        new Date().toLocaleTimeString() +
        "] " +
        String(message);

    logElement.textContent +=
        line +
        "\n";

    logElement.scrollTop =
        logElement.scrollHeight;
}

function setStatus(message) {
    statusElement.textContent =
        message;
}

function setProgress(value, text = null) {
    const v =
        Math.max(
            0,
            Math.min(
                100,
                Number(value) || 0
            )
        );

    progressBar.style.width =
        v + "%";

    progressText.textContent =
        text ||
        Math.round(v) + "%";
}

function updateFileText() {
    if (!files.length) {
        filesText.textContent =
            "Keine Bilder ausgewählt";

        return;
    }

    filesText.textContent =
        files.length +
        " Bilder ausgewählt";
}

function getSettings() {
    switch (quality.value) {

        case "draft":
            return {
                maxIters: 30000,
                initTarget: 60000,
                itersPerFrame: 12,
                trainer: {
                    shDeg: 1
                }
            };

        case "ultra":
            return {
                maxIters: 120000,
                initTarget: 200000,
                itersPerFrame: 10,
                trainer: {
                    shDeg: 3
                }
            };

        default:
            return {
                maxIters: 70000,
                initTarget: 100000,
                itersPerFrame: 12,
                trainer: {
                    shDeg: 3
                }
            };
    }
}

function resetUI() {
    exportedBlob = null;

    downloadButton.disabled =
        true;

    finishButton.disabled =
        true;

    pauseButton.disabled =
        true;

    startButton.disabled =
        false;

    running = false;

    setProgress(0);

    logElement.textContent =
        "";
}

photoInput.addEventListener(
    "change",
    () => {

        files = Array.from(
            photoInput.files || []
        );

        files =
            files.filter(
                file =>
                    file.type.startsWith(
                        "image/"
                    )
            );

        updateFileText();
    }
);

dropZone.addEventListener(
    "dragover",
    event => {
        event.preventDefault();
        dropZone.classList.add(
            "active"
        );
    }
);

dropZone.addEventListener(
    "dragleave",
    () => {
        dropZone.classList.remove(
            "active"
        );
    }
);

dropZone.addEventListener(
    "drop",
    event => {

        event.preventDefault();

        dropZone.classList.remove(
            "active"
        );

        files =
            Array.from(
                event.dataTransfer.files
            ).filter(
                file =>
                    file.type.startsWith(
                        "image/"
                    )
            );

        updateFileText();
    }
);

function connectEvents() {

    session.on(
        "log",
        message => {
            log(message);
        }
    );

    session.on(
        "stage",
        event => {

            const stage =
                event.stage || "";

            const total =
                Number(event.total) || 1;

            const done =
                Number(event.done) || 0;

            const percent =
                done /
                total *
                100;

            setProgress(
                percent,
                stage +
                " " +
                done +
                "/" +
                total
            );

            if (event.detail) {
                log(
                    JSON.stringify(
                        event.detail
                    )
                );
            }
        }
    );

    session.on(
        "metrics",
        event => {

            const iter =
                Number(event.iter) || 0;

            const splats =
                Number(event.splats) || 0;

            const speed =
                Number(
                    event.itersPerSec
                ) || 0;

            const max =
                Number(
                    getSettings()
                        .maxIters
                );

            const percent =
                max > 0
                    ? (
                        iter /
                        max *
                        100
                    )
                    : 0;

            setProgress(
                percent,
                "Training " +
                Math.min(
                    100,
                    Math.round(
                        percent
                    )
                ) +
                "% · " +
                iter +
                " Iterationen · " +
                splats +
                " Splats"
            );

            if (
                event.psnrTrain != null
            ) {
                log(
                    "PSNR: " +
                    event.psnrTrain.toFixed(2) +
                    " dB"
                );
            }

            if (
                speed > 0
            ) {
                log(
                    "Geschwindigkeit: " +
                    speed +
                    " Iterationen/s"
                );
            }
        }
    );

    session.on(
        "event",
        async event => {

            if (
                event.kind ===
                "train-complete"
            ) {

                running = false;

                setStatus(
                    "Training fertig"
                );

                pauseButton.disabled =
                    true;

                finishButton.disabled =
                    true;

                try {
                    await exportModel();
                } catch (error) {
                    showError(error);
                }
            }

            if (
                event.kind ===
                "device-lost"
            ) {

                running = false;

                pauseButton.disabled =
                    true;

                finishButton.disabled =
                    false;

                setStatus(
                    "GPU getrennt"
                );

                log(
                    "Die WebGPU-Verbindung wurde getrennt."
                );
            }
        }
    );
}

async function exportModel() {

    if (!session) {
        return;
    }

    setStatus(
        "PLY wird erstellt..."
    );

    log(
        "Export gestartet."
    );

    exportedBlob =
        await session.exportPlyBlob();

    downloadButton.disabled =
        false;

    finishButton.disabled =
        true;

    setProgress(
        100,
        "Fertig"
    );

    setStatus(
        "3D-Modell fertig"
    );

    log(
        "PLY-Export fertig."
    );
}

function showError(error) {

    running = false;

    startButton.disabled =
        false;

    pauseButton.disabled =
        true;

    finishButton.disabled =
        true;

    const message =
        error &&
        error.message
            ? error.message
            : String(error);

    setStatus(
        "Fehler"
    );

    log(
        "FEHLER: " +
        message
    );

    console.error(error);
}

startButton.addEventListener(
    "click",
    async () => {

        if (
            files.length < 2
        ) {

            setStatus(
                "Mindestens 2 Fotos"
            );

            log(
                "Bitte mindestens 2 Bilder auswählen."
            );

            return;
        }

        if (
            files.length > 200
        ) {

            setStatus(
                "Maximal 200 Fotos"
            );

            files =
                files.slice(
                    0,
                    200
                );

            updateFileText();
        }

        resetUI();

        startButton.disabled =
            true;

        pauseButton.disabled =
            false;

        finishButton.disabled =
            false;

        running = true;

        setStatus(
            "WebGPU wird gestartet..."
        );

        log(
            "Scan gestartet."
        );

        try {

            session =
                createSession(
                    getSettings()
                );

            connectEvents();

            setStatus(
                "Fotos werden geladen..."
            );

            await session.load(
                files
            );

            log(
                "Fotos geladen."
            );

            setStatus(
                "Kameras werden berechnet..."
            );

            await session.solve();

            log(
                "Kamera-Positionen berechnet."
            );

            setStatus(
                "3D-Modell wird vorbereitet..."
            );

            await session.seed();

            log(
                "Gaussians erstellt."
            );

            session.view.attach(
                canvas
            );

            session.start();

            setStatus(
                "Training läuft..."
            );

        } catch (error) {

            showError(error);
        }
    }
);

pauseButton.addEventListener(
    "click",
    () => {

        if (!session) {
            return;
        }

        if (running) {

            session.pause();

            running = false;

            pauseButton.textContent =
                "Weiter";

            setStatus(
                "Pausiert"
            );

            log(
                "Training pausiert."
            );

        } else {

            session.start();

            running = true;

            pauseButton.textContent =
                "Pause";

            setStatus(
                "Training läuft..."
            );

            log(
                "Training fortgesetzt."
            );
        }
    }
);

finishButton.addEventListener(
    "click",
    async () => {

        if (!session) {
            return;
        }

        try {

            finishButton.disabled =
                true;

            session.pause();

            running = false;

            setStatus(
                "Modell wird abgeschlossen..."
            );

            await session.finish();

        } catch (error) {

            showError(error);
        }
    }
);

downloadButton.addEventListener(
    "click",
    () => {

        if (!exportedBlob) {
            return;
        }

        const url =
            URL.createObjectURL(
                exportedBlob
            );

        const link =
            document.createElement(
                "a"
            );

        link.href = url;

        link.download =
            "3d-scan.ply";

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        setTimeout(
            () => {
                URL.revokeObjectURL(
                    url
                );
            },
            1000
        );
    }
);

window.addEventListener(
    "resize",
    () => {

        if (!session) {
            return;
        }

        canvas.width =
            Math.max(
                1,
                Math.floor(
                    canvas.clientWidth *
                    devicePixelRatio
                )
            );

        canvas.height =
            Math.max(
                1,
                Math.floor(
                    canvas.clientHeight *
                    devicePixelRatio
                )
            );

        session.view.renderNow();
    }
);

canvas.width =
    Math.max(
        1,
        Math.floor(
            canvas.clientWidth *
            devicePixelRatio
        )
    );

canvas.height =
    Math.max(
        1,
        Math.floor(
            canvas.clientHeight *
            devicePixelRatio
        )
    );

setStatus(
    "Bereit"
);
