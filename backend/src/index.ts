import { createLogger } from "./logger";
import { DB_URL } from "./db/credentials";
import { app } from "./server";
import { loadStaticSections } from "./db/static-store";

const logger = createLogger("index");

try {
    if (DB_URL) {
        const { connectToDb } = await import("./db");
        await connectToDb(DB_URL);
        logger.info("Connected to MongoDB");
    } else {
        logger.info("No DB_URL configured, loading static data...");
        await loadStaticSections();
    }

    const server = app.listen(8080, () => {
        logger.info(`Server listening on %O`, server.address());
    });
} catch (e) {
    logger.info(`MongoDB unavailable, falling back to static data...`);
    try {
        await loadStaticSections();
        const server = app.listen(8080, () => {
            logger.info(
                `Server listening on %O (static mode)`,
                server.address(),
            );
        });
    } catch (e2) {
        logger.error(`Error starting server: ${e2}`);
    }
}
