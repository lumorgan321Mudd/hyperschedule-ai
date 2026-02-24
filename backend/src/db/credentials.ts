import * as process from "process";

export const DB_URL: string | undefined = process.env.DB_URL;

/** Use this in standalone scripts that always require a database connection */
export function requireDbUrl(): string {
    if (!DB_URL)
        throw Error("DB_URL environment variable is required but not set");
    return DB_URL;
}
