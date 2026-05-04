import type { Request, Response, NextFunction } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { json as jsonParser } from "milliparsec";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import * as APIv4 from "hyperschedule-shared/api/v4";

import { signUser } from "../../auth/token";
import { AUTH_TOKEN_COOKIE_NAME } from "hyperschedule-shared/api/constants";
import { COOKIE_DOMAIN } from "../cookie-domain";
import {
    createUserWithPassword,
    getUserByUsername,
    getUserByEmail,
    getUser,
    setUserPassword,
    setPasswordResetToken,
} from "../../db/models/user";
import { createLogger } from "../../logger";

const logger = createLogger("routes.auth.account");

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_VALIDITY_MS = 60 * 60 * 1000; // 1 hour

export const accountApp = new App({
    settings: { xPoweredBy: false },
    onError(err: any, req, res) {
        if (Object.hasOwn(err, "code")) return res.status(err.code).end();
        logger.info("Account error: %o", err);
        return res.status(400).send(`${err}`);
    },
}).use((req: Request, res: Response, next: NextFunction) => {
    res.header(
        "Cache-Control",
        "private,no-cache,no-store,max-age=0,must-revalidate",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
        res.header("Access-Control-Allow-Methods", "POST")
            .status(204)
            .end();
        return;
    }
    next();
});

function setAuthCookie(response: Response, userId: string) {
    const sig = signUser({ uuid: userId });
    const expires = new Date();
    expires.setDate(expires.getDate() + 365);
    response.cookie(AUTH_TOKEN_COOKIE_NAME, sig, {
        domain: COOKIE_DOMAIN,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        expires,
    });
}

function clearAuthCookie(response: Response) {
    response.cookie(AUTH_TOKEN_COOKIE_NAME, "", {
        domain: COOKIE_DOMAIN,
        maxAge: 0,
    });
}

accountApp
    .route("/signup")
    .use(jsonParser())
    .post(async (request: Request, response: Response) => {
        const parsed = APIv4.SignupRequest.safeParse(request.body);
        if (!parsed.success) {
            return response
                .status(400)
                .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        }
        const { username, email, password, school, classYear, role } =
            parsed.data;
        const usernameLc = username.toLowerCase();
        const emailLc = email.toLowerCase();

        // Students must provide a class year so graduation requirements work.
        if (role !== "advisor" && classYear === undefined) {
            return response
                .status(400)
                .json({ error: "Class year is required for students" });
        }

        const existingUsername = await getUserByUsername(usernameLc);
        if (existingUsername !== null) {
            return response.status(409).json({ error: "Username already taken" });
        }
        const existingEmail = await getUserByEmail(emailLc);
        if (existingEmail !== null) {
            return response.status(409).json({ error: "Email already registered" });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const userId = await createUserWithPassword({
            username: usernameLc,
            email: emailLc,
            passwordHash,
            school,
            classYear: role === "advisor" ? undefined : classYear,
            role,
        });

        setAuthCookie(response, userId);
        return response.status(200).json({ userId });
    });

accountApp
    .route("/login")
    .use(jsonParser())
    .post(async (request: Request, response: Response) => {
        const parsed = APIv4.LoginRequest.safeParse(request.body);
        if (!parsed.success) {
            return response.status(400).json({ error: "Invalid request" });
        }
        const { username, password } = parsed.data;
        const user = await getUserByUsername(username);
        if (user === null || !user.passwordHash) {
            return response
                .status(401)
                .json({ error: "Invalid username or password" });
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
            return response
                .status(401)
                .json({ error: "Invalid username or password" });
        }
        setAuthCookie(response, user._id);
        return response.status(200).json({ userId: user._id });
    });

accountApp.post("/logout", (request: Request, response: Response) => {
    clearAuthCookie(response);
    return response.status(200).json({ ok: true });
});

accountApp
    .route("/request-password-reset")
    .use(jsonParser())
    .post(async (request: Request, response: Response) => {
        const parsed = APIv4.RequestPasswordResetRequest.safeParse(request.body);
        if (!parsed.success) {
            return response.status(400).json({ error: "Invalid request" });
        }
        const user = await getUserByEmail(parsed.data.email);
        // Always respond OK so callers can't enumerate emails
        if (user !== null) {
            const token = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto
                .createHash("sha256")
                .update(token)
                .digest("hex");
            const expiry = new Date(Date.now() + RESET_TOKEN_VALIDITY_MS);
            await setPasswordResetToken(user._id, tokenHash, expiry);

            const appUrl =
                process.env.APP_URL ??
                (process.env.NODE_ENV === "production"
                    ? "https://hyperschedule.io"
                    : "http://localhost:3000");
            const resetLink = `${appUrl}/?reset-token=${token}`;

            // Stub: log the reset link. Wire Resend (or other) here later.
            logger.info(
                `Password reset for ${user.email}: ${resetLink} (token expires ${expiry.toISOString()})`,
            );
            // eslint-disable-next-line no-console
            console.log(`\n[PASSWORD RESET] ${user.email} -> ${resetLink}\n`);
        }
        return response.status(200).json({ ok: true });
    });

accountApp
    .route("/reset-password")
    .use(jsonParser())
    .post(async (request: Request, response: Response) => {
        const parsed = APIv4.ResetPasswordRequest.safeParse(request.body);
        if (!parsed.success) {
            return response
                .status(400)
                .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
        }
        const { token, password } = parsed.data;
        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        // Find user by token hash. Brute-force scan in static mode; indexed in mongo.
        const { collections } = await import("../../db/collections");
        const { staticMode, staticUsers } = await import(
            "../../db/static-store"
        );
        let user: APIv4.ServerUser | null = null;
        if (staticMode) {
            for (const u of staticUsers.values()) {
                if (u.passwordResetTokenHash === tokenHash) {
                    user = u;
                    break;
                }
            }
        } else {
            user = await collections.users.findOne({
                passwordResetTokenHash: tokenHash,
            });
        }

        if (user === null) {
            return response.status(400).json({ error: "Invalid or expired token" });
        }
        if (
            !user.passwordResetExpiry ||
            new Date(user.passwordResetExpiry).getTime() < Date.now()
        ) {
            return response.status(400).json({ error: "Invalid or expired token" });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await setUserPassword(user._id, passwordHash);
        setAuthCookie(response, user._id);
        return response.status(200).json({ ok: true });
    });

accountApp
    .route("/change-password")
    .use(jsonParser())
    .post(async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const body = request.body as
            | { currentPassword?: unknown; newPassword?: unknown }
            | undefined;
        const currentPassword =
            typeof body?.currentPassword === "string"
                ? body.currentPassword
                : "";
        const newPassword =
            typeof body?.newPassword === "string" ? body.newPassword : "";
        if (newPassword.length < 8) {
            return response
                .status(400)
                .json({ error: "Password must be at least 8 characters" });
        }
        const user = await getUser(request.userToken.uuid);
        if (!user.passwordHash) {
            return response.status(400).json({ error: "No password set" });
        }
        const ok = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!ok) {
            return response.status(401).json({ error: "Incorrect password" });
        }
        const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await setUserPassword(user._id, passwordHash);
        return response.status(200).json({ ok: true });
    });
