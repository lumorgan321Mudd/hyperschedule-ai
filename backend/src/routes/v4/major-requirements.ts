import type { Request, Response } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { readFile } from "fs/promises";
import { join } from "path";
import { createLogger } from "../../logger";

const logger = createLogger("routes.major-requirements");

interface SchoolInfo {
    code: string;
    name: string;
    dataFile: string;
}

const SCHOOLS: SchoolInfo[] = [
    { code: "hmc", name: "Harvey Mudd College", dataFile: "hmc.json" },
    { code: "pomona", name: "Pomona College", dataFile: "pomona.json" },
    { code: "scripps", name: "Scripps College", dataFile: "scripps.json" },
    { code: "cmc", name: "Claremont McKenna College", dataFile: "cmc.json" },
    { code: "pitzer", name: "Pitzer College", dataFile: "pitzer.json" },
];

const requirementsCache = new Map<string, unknown>();

async function loadRequirements(schoolCode: string): Promise<unknown | null> {
    if (requirementsCache.has(schoolCode)) {
        return requirementsCache.get(schoolCode)!;
    }

    const school = SCHOOLS.find((s) => s.code === schoolCode);
    if (!school) return null;

    const filePath = join(
        process.cwd(),
        "..",
        "data",
        "major-requirements",
        school.dataFile,
    );

    try {
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        requirementsCache.set(schoolCode, data);
        return data;
    } catch (e) {
        logger.warn(`No requirements data for ${schoolCode}: ${e}`);
        return null;
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

// GET /schools — list all supported schools
majorRequirementsApp.get(
    "/schools",
    async function (_request: Request, response: Response) {
        const schools = await Promise.all(
            SCHOOLS.map(async (s) => {
                const data = await loadRequirements(s.code);
                return {
                    code: s.code,
                    name: s.name,
                    hasMajorData: data !== null,
                };
            }),
        );

        return response
            .header("Content-Type", "application/json")
            .send({ schools });
    },
);

// GET /:school — get requirements for a specific school
majorRequirementsApp.get(
    "/:school",
    async function (request: Request, response: Response) {
        const schoolCode = (request.params.school ?? "").toLowerCase();
        const data = await loadRequirements(schoolCode);

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
