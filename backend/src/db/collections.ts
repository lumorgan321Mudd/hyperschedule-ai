import type * as APIv4 from "hyperschedule-shared/api/v4";
import type {
    SharedBlockSnapshot,
    SharedScheduleSnapshot,
    AdvisorLink,
    HsaSubmission,
} from "hyperschedule-shared/api/v4";
import { connector } from "./connector";
import type { Collection } from "mongodb";

export type DBSection = Omit<APIv4.Section, "identifier"> & {
    _id: APIv4.SectionIdentifier;
};

export interface DBCollections {
    users: Collection<APIv4.ServerUser>;
    sections: Collection<DBSection>;
    sharedBlockSnapshots: Collection<SharedBlockSnapshot>;
    sharedScheduleSnapshots: Collection<SharedScheduleSnapshot>;
    advisorLinks: Collection<AdvisorLink>;
    hsaSubmissions: Collection<HsaSubmission>;
}

/* we use getters to defer the collection initialization to the first
 * time we access the properies, which hopefully happens after a db
 * connection is already established at runtime.
 *
 * sorry kye i know you don't like oop
 */
let obj = {};
Object.defineProperties(obj, {
    users: {
        get(): Collection<APIv4.User> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<APIv4.User>("users");
        },
    },
    sections: {
        get(): Collection<APIv4.Section> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<APIv4.Section>("sections");
        },
    },
    sharedBlockSnapshots: {
        get(): Collection<SharedBlockSnapshot> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<SharedBlockSnapshot>(
                "shared_block_snapshots",
            );
        },
    },
    sharedScheduleSnapshots: {
        get(): Collection<SharedScheduleSnapshot> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<SharedScheduleSnapshot>(
                "shared_schedule_snapshots",
            );
        },
    },
    advisorLinks: {
        get(): Collection<AdvisorLink> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<AdvisorLink>("advisor_links");
        },
    },
    hsaSubmissions: {
        get(): Collection<HsaSubmission> {
            if (!connector.connected) throw Error("Database not connected");
            return connector.db.collection<HsaSubmission>("hsa_submissions");
        },
    },
});

export const collections = obj as DBCollections;
