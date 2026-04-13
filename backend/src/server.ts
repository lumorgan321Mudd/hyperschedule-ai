import { App } from "@tinyhttp/app";
import { cookieParser } from "@tinyhttp/cookie-parser";
import { v4App } from "./routes/v4";
import { v3App } from "./routes/v3";
import { authApp } from "./routes/auth";
import { middleware } from "./middleware";
import { existsSync, readFileSync } from "fs";
import { join, extname } from "path";

const app = new App({ settings: { xPoweredBy: false } })
    .use(cookieParser())
    .use("", middleware)
    .use("/v4", v4App)
    .use("/v3", v3App)
    .use("/auth", authApp);

// Serve frontend static files (used in production single-service mode)
const FRONTEND_DIST = join(process.cwd(), "..", "frontend", "dist");
if (existsSync(FRONTEND_DIST)) {
    const MIME_TYPES: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".map": "application/json",
    };

    const indexHtml = existsSync(join(FRONTEND_DIST, "index.html"))
        ? readFileSync(join(FRONTEND_DIST, "index.html"))
        : null;

    app.get("*", (req, res) => {
        const filePath = join(FRONTEND_DIST, req.path);
        if (req.path !== "/" && existsSync(filePath)) {
            const ext = extname(filePath);
            const mime = MIME_TYPES[ext] ?? "application/octet-stream";
            res.header("Content-Type", mime)
                .header("Cache-Control", "public,max-age=31536000,immutable")
                .send(readFileSync(filePath));
        } else if (indexHtml) {
            // SPA fallback
            res.header("Content-Type", "text/html")
                .header("Cache-Control", "no-cache")
                .send(indexHtml);
        } else {
            res.status(404).send("Not found");
        }
    });
}

export { app };
