import { App } from "@tinyhttp/app";
import { createLogger } from "../../logger";
import { signUser } from "../../auth/token";
import { AUTH_TOKEN_COOKIE_NAME } from "hyperschedule-shared/api/constants";
import { COOKIE_DOMAIN } from "../cookie-domain";
import { staticUsers, staticMode } from "../../db/static-store";
import { uuid4 } from "../../db/utils";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import * as APIv4 from "hyperschedule-shared/api/v4";

const logger = createLogger("routes.auth.dev-login");

export const devLoginApp = new App({ settings: { xPoweredBy: false } });

// GET handler serves a simple login page
devLoginApp.get("/dev-login", (request, response) => {
    if (process.env.NODE_ENV === "production") {
        return response.status(404).send("Not found");
    }
    response.header("Content-Type", "text/html").send(`<!DOCTYPE html>
<html><head><title>Dev Login</title></head><body style="font-family:sans-serif;max-width:400px;margin:40px auto">
<h2>Hyperschedule Dev Login</h2>
<form id="f"><label>Email:<br><input name="eppn" value="student@hmc.edu" style="width:100%"></label><br><br>
<label>College:<br><select name="org" style="width:100%">
<option>Harvey Mudd College</option><option>Pomona College</option>
<option>Claremont McKenna College</option><option>Scripps College</option>
<option>Pitzer College</option></select></label><br><br>
<label>Role (optional):<br><select name="role" style="width:100%">
<option value="">—</option><option value="student">Student</option>
<option value="advisor">Advisor</option></select></label><br><br>
<button type="submit" style="padding:8px 24px">Log In</button></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();
const d=new FormData(e.target),p=new URLSearchParams();
d.forEach((v,k)=>{if(v)p.set(k,v)});
await fetch('/auth/dev-login?'+p,{method:'POST',credentials:'include'});
window.location=new URLSearchParams(window.location.search).get('redirect')||'http://localhost:5003/'}</script></body></html>`);
});

devLoginApp.post("/dev-login", async (request, response) => {
    if (process.env.NODE_ENV === "production") {
        return response.status(404).send("Not found");
    }

    const eppn =
        (request.query.eppn as string) ?? "dev-student@hmc.edu";
    const role = (request.query.role as string) ?? undefined;
    const orgName =
        (request.query.org as string) ?? "Harvey Mudd College";

    let school: APIv4.School = APIv4.School.Unknown;
    switch (orgName) {
        case "Harvey Mudd College":
            school = APIv4.School.HMC;
            break;
        case "Scripps College":
            school = APIv4.School.SCR;
            break;
        case "Pomona College":
            school = APIv4.School.POM;
            break;
        case "Pitzer College":
            school = APIv4.School.PTZ;
            break;
        case "Claremont McKenna College":
            school = APIv4.School.CMC;
            break;
    }

    let userId: string;

    if (staticMode) {
        // Find existing user by eppn or create new one
        let existingUser: APIv4.ServerUser | undefined;
        for (const user of staticUsers.values()) {
            if (user.eppn === eppn) {
                existingUser = user;
                break;
            }
        }

        if (existingUser) {
            userId = existingUser._id;
            logger.info(`Found existing static user ${userId} for ${eppn}`);
        } else {
            userId = uuid4("u");
            const scheduleId = uuid4("s");
            const user: APIv4.ServerUser = {
                _id: userId,
                eppn,
                school,
                schedules: {
                    [scheduleId]: {
                        term: CURRENT_TERM,
                        name: "Schedule 1",
                        sections: [],
                    },
                },
                ...(role ? { role: role as APIv4.UserRole } : {}),
            };
            staticUsers.set(userId, user);
            logger.info(`Created static user ${userId} for ${eppn}`);
        }
    } else {
        // Use real DB
        const { getOrCreateUser } = await import("../../db/models/user");
        userId = await getOrCreateUser(eppn, orgName);
    }

    const sig = signUser({ uuid: userId });
    const expires = new Date();
    expires.setDate(expires.getDate() + 365);

    return response
        .cookie(AUTH_TOKEN_COOKIE_NAME, sig, {
            domain: COOKIE_DOMAIN,
            secure: false,
            sameSite: "lax",
            expires,
        })
        .status(200)
        .json({ userId, eppn, school });
});
