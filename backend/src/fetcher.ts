const prefix = process.env.FETCHER_PREFIX;
if (prefix === undefined) {
    throw Error("FETCHER_PREFIX environment variable undefined");
}
import { connectToDb } from "./db";
import { requireDbUrl } from "./db/credentials";
import { runScheduler } from "./hmc-api/fetcher/scheduler";

await connectToDb(requireDbUrl());
await runScheduler(prefix);
