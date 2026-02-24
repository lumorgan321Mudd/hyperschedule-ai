/**
 * This file is used to load data for only one semester for test data generation
 */

import { loadAllForTerm } from "./hmc-api/fetcher/fetch";
import { createLogger } from "./logger";

const logger = createLogger("fetch-all");

import { requireDbUrl } from "./db/credentials";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { connectToDb, closeDb } from "./db/connector";
import { updateSections } from "./db/models/course";
import { linkCourseData } from "./hmc-api/data-linker";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";

await connectToDb(requireDbUrl());

logger.info("Connected to DB");

const files = await loadAllForTerm(CURRENT_TERM);
const sections = linkCourseData(files, CURRENT_TERM);
await updateSections(sections, CURRENT_TERM);

logger.info(`Updated data for ${APIv4.stringifyTermIdentifier(CURRENT_TERM)}`);

await closeDb();
