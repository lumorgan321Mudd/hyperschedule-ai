import type { Request, Response } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { createLogger } from "../../logger";
import { DEFAULT_CATALOG_YEAR } from "hyperschedule-shared/api/v4";

const logger = createLogger("routes.major-requirements");

interface SchoolInfo {
    code: string;
    name: string;
}

const SCHOOLS: SchoolInfo[] = [
    { code: "hmc", name: "Harvey Mudd College" },
    { code: "pomona", name: "Pomona College" },
    { code: "scripps", name: "Scripps College" },
    { code: "cmc", name: "Claremont McKenna College" },
    { code: "pitzer", name: "Pitzer College" },
];

const requirementsCache = new Map<string, unknown>();

function dataDir(): string {
    return join(process.cwd(), "..", "data", "major-requirements");
}

async function loadRequirements(
    schoolCode: string,
    catalogYear: string,
): Promise<unknown | null> {
    const cacheKey = `${schoolCode}:${catalogYear}`;
    if (requirementsCache.has(cacheKey)) {
        return requirementsCache.get(cacheKey)!;
    }

    const school = SCHOOLS.find((s) => s.code === schoolCode);
    if (!school) return null;

    const filePath = join(dataDir(), schoolCode, `${catalogYear}.json`);

    try {
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        requirementsCache.set(cacheKey, data);
        return data;
    } catch (e) {
        logger.warn(
            `No requirements data for ${schoolCode}/${catalogYear}: ${e}`,
        );
        return null;
    }
}

async function getAvailableYears(schoolCode: string): Promise<string[]> {
    const dirPath = join(dataDir(), schoolCode);
    try {
        const files = await readdir(dirPath);
        return files
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(".json", ""))
            .sort();
    } catch {
        return [];
    }
}

const majorRequirementsApp = new App({
    settings: { xPoweredBy: false },
}).use((req: Request, res: Response, next) => {
    res.header("Cache-Control", "public,max-age=3600");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
        res.header("Access-Control-Allow-Methods", "GET")
            .header("Access-Control-Allow-Headers", "Content-Type")
            .status(204)
            .end();
        return;
    }
    next();
});

// GET /schools — list all supported schools with available catalog years
majorRequirementsApp.get(
    "/schools",
    async function (_request: Request, response: Response) {
        const schools = await Promise.all(
            SCHOOLS.map(async (s) => {
                const years = await getAvailableYears(s.code);
                return {
                    code: s.code,
                    name: s.name,
                    hasMajorData: years.length > 0,
                    availableCatalogYears: years,
                };
            }),
        );

        return response
            .header("Content-Type", "application/json")
            .send({ schools });
    },
);

// GET /:school/:catalogYear — get requirements for a specific school and catalog year
majorRequirementsApp.get(
    "/:school/:catalogYear",
    async function (request: Request, response: Response) {
        const schoolCode = (request.params.school ?? "").toLowerCase();
        const catalogYear = request.params.catalogYear ?? "";
        const data = await loadRequirements(schoolCode, catalogYear);

        if (data === null) {
            return response
                .status(404)
                .send(
                    `No requirements data for ${schoolCode}/${catalogYear}`,
                );
        }

        return response
            .header("Content-Type", "application/json")
            .send(data);
    },
);

// GET /:school — get requirements for a specific school (defaults to latest catalog year)
majorRequirementsApp.get(
    "/:school",
    async function (request: Request, response: Response) {
        const schoolCode = (request.params.school ?? "").toLowerCase();

        // Try default catalog year first, then fall back to latest available
        let data = await loadRequirements(schoolCode, DEFAULT_CATALOG_YEAR);
        if (data === null) {
            const years = await getAvailableYears(schoolCode);
            if (years.length > 0) {
                data = await loadRequirements(
                    schoolCode,
                    years[years.length - 1]!,
                );
            }
        }

        if (data === null) {
            return response
                .status(404)
                .send(`No requirements data for ${schoolCode}`);
        }

        return response
            .header("Content-Type", "application/json")
            .send(data);
    },
);

export { majorRequirementsApp };
