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
    if (process.env.NODE_ENV === "production" && !process.env.ENABLE_DEV_LOGIN) {
        return response.status(404).send("Not found");
    }
    response.header("Content-Type", "text/html").send(`<!DOCTYPE html>
<html><head><title>Dev Login</title>
<style>
body{font-family:sans-serif;max-width:420px;margin:40px auto;padding:0 16px}
label{display:block;margin-bottom:12px;font-weight:600;font-size:14px}
label>*{font-weight:400}
input,select{width:100%;padding:6px 8px;margin-top:4px;font-size:14px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
button{padding:10px 28px;font-size:14px;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:4px}
button:hover{background:#1d4ed8}
.hint{font-size:12px;color:#666;margin-top:2px}
</style></head><body>
<h2>Hyperschedule Dev Login</h2>
<form id="f">
<label>Email:<input name="eppn" value="student@hmc.edu"></label>
<label>College:<select name="org">
<option>Harvey Mudd College</option><option>Pomona College</option>
<option>Claremont McKenna College</option><option>Scripps College</option>
<option>Pitzer College</option></select></label>
<label>Class Year:<select name="classYear">
${APIv4.SUPPORTED_CLASS_YEARS.map(
        (y) =>
            `<option value="${y}"${y === APIv4.SUPPORTED_CLASS_YEARS[APIv4.SUPPORTED_CLASS_YEARS.length - 1] ? " selected" : ""}>Class of ${y} (${APIv4.CLASS_YEAR_TO_CATALOG[y]} catalog)</option>`,
    ).join("")}
</select>
<div class="hint">Determines which catalog year your graduation requirements use.</div></label>
<label>Role (optional):<select name="role">
<option value="">—</option><option value="student">Student</option>
<option value="advisor">Advisor</option></select></label>
<button type="submit">Log In</button></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();
const d=new FormData(e.target),p=new URLSearchParams();
d.forEach((v,k)=>{if(v)p.set(k,v)});
await fetch('/auth/dev-login?'+p,{method:'POST',credentials:'include'});
window.location=new URLSearchParams(window.location.search).get('redirect')||'/'}</script></body></html>`);
});

devLoginApp.post("/dev-login", async (request, response) => {
    if (process.env.NODE_ENV === "production" && !process.env.ENABLE_DEV_LOGIN) {
        return response.status(404).send("Not found");
    }

    const eppn =
        (request.query.eppn as string) ?? "dev-student@hmc.edu";
    const role = (request.query.role as string) ?? undefined;
    const orgName =
        (request.query.org as string) ?? "Harvey Mudd College";
    const classYearStr = request.query.classYear as string | undefined;
    const classYear = classYearStr ? parseInt(classYearStr, 10) : undefined;

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
            // Update school, classYear, and role if changed
            existingUser.school = school;
            if (classYear) existingUser.classYear = classYear;
            if (role) existingUser.role = role as APIv4.UserRole;
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
                ...(classYear ? { classYear } : {}),
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
