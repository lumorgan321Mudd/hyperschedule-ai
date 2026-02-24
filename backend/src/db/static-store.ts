import { readFile } from "fs/promises";
import { join } from "path";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import type { SharedBlockSnapshot } from "hyperschedule-shared/api/v4";
import { createLogger } from "../logger";

const logger = createLogger("db.static-store");

export let staticSections: APIv4.Section[] = [];
export let staticMode = false;
export const staticUsers = new Map<string, APIv4.ServerUser>();
export const staticSnapshots = new Map<string, SharedBlockSnapshot>();

export async function loadStaticSections(): Promise<void> {
    const filePath = join(process.cwd(), "..", "data", "sp2026-sections.json");
    logger.info("Loading static sections from %s", filePath);
    try {
        const raw = await readFile(filePath, "utf-8");
        staticSections = JSON.parse(raw) as APIv4.Section[];
        staticMode = true;
        logger.info("Loaded %d static sections", staticSections.length);
    } catch (e) {
        logger.warn("No static sections file found, starting with empty data");
        staticSections = [];
        staticMode = true;
    }
}
