/**
 * Similar to endpoints.ts, this file is left out of version control using
 * ```
 * git update-index --skip-worktree src/auth/keys.ts
 * ```
 *
 * Why not environment variables? Because keys are multi-line and handling of multiline env vars are really
 * inconsistent across OSes and packages.
 */

import { PUBKEY as devPub, PRIVKEY as devPriv } from "./dev-keys";

let pub: string, priv: string;

if (process.env.JWT_PUBKEY && process.env.JWT_PRIVKEY) {
    // Production: use environment variables (base64-encoded)
    pub = Buffer.from(process.env.JWT_PUBKEY, "base64").toString("utf-8");
    priv = Buffer.from(process.env.JWT_PRIVKEY, "base64").toString("utf-8");
} else {
    // Development: use built-in dev keys
    pub = devPub;
    priv = devPriv;
}

export { pub as PUBKEY, priv as PRIVKEY };
