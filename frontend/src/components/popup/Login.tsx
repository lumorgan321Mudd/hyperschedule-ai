import Css from "./Login.module.css";
import AppCss from "@components/App.module.css";
import useStore from "@hooks/store";
import { useUserStore } from "@hooks/store/user";
import classNames from "classnames";
import { useState } from "react";
import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    SUPPORTED_CLASS_YEARS,
    CLASS_YEAR_TO_CATALOG,
} from "hyperschedule-shared/api/v4/graduation-block";

const COLLEGES: { label: string; value: APIv4.School }[] = [
    { label: "Harvey Mudd College", value: APIv4.School.HMC },
    { label: "Pomona College", value: APIv4.School.POM },
    { label: "Claremont McKenna College", value: APIv4.School.CMC },
    { label: "Scripps College", value: APIv4.School.SCR },
    { label: "Pitzer College", value: APIv4.School.PTZ },
];

type Mode = "login" | "signup" | "forgot";

export default function Login(props: { continuation?: () => void }) {
    const confirmGuest = useUserStore((store) => store.confirmGuest);
    const getUser = useUserStore((store) => store.getUser);
    const setPopup = useStore((store) => store.setPopup);

    const [mode, setMode] = useState<Mode>("login");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    // Login state
    const [loginUsername, setLoginUsername] = useState("");
    const [loginPassword, setLoginPassword] = useState("");

    // Signup state
    const [signupUsername, setSignupUsername] = useState("");
    const [signupEmail, setSignupEmail] = useState("");
    const [signupPassword, setSignupPassword] = useState("");
    const [signupSchool, setSignupSchool] = useState<APIv4.School>(
        APIv4.School.HMC,
    );
    const [signupClassYear, setSignupClassYear] = useState<number>(
        SUPPORTED_CLASS_YEARS[SUPPORTED_CLASS_YEARS.length - 1] ?? 2029,
    );
    const [signupRole, setSignupRole] = useState<"student" | "advisor">(
        "student",
    );

    // Forgot state
    const [forgotEmail, setForgotEmail] = useState("");

    function clearMessages() {
        setError(null);
        setInfo(null);
    }

    function switchMode(next: Mode) {
        clearMessages();
        setMode(next);
    }

    async function handleLogin() {
        setLoading(true);
        clearMessages();
        try {
            const res = await fetch(`${__API_URL__}/auth/login`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: loginUsername.trim().toLowerCase(),
                    password: loginPassword,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? `Login failed (${res.status})`);
            }
            await getUser();
            setPopup(null);
            props.continuation?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Login failed");
        } finally {
            setLoading(false);
        }
    }

    async function handleSignup() {
        setLoading(true);
        clearMessages();
        try {
            const username = signupUsername.trim().toLowerCase();
            if (!/^[a-z0-9_]{3,32}$/.test(username)) {
                throw new Error(
                    "Username must be 3-32 chars (letters, digits, underscore)",
                );
            }
            if (signupPassword.length < 8) {
                throw new Error("Password must be at least 8 characters");
            }
            const res = await fetch(`${__API_URL__}/auth/signup`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    email: signupEmail.trim().toLowerCase(),
                    password: signupPassword,
                    school: signupSchool,
                    role: signupRole,
                    ...(signupRole === "student"
                        ? { classYear: signupClassYear }
                        : {}),
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? `Signup failed (${res.status})`);
            }
            await getUser();
            setPopup(null);
            props.continuation?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Signup failed");
        } finally {
            setLoading(false);
        }
    }

    async function handleForgot() {
        setLoading(true);
        clearMessages();
        try {
            const res = await fetch(
                `${__API_URL__}/auth/request-password-reset`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: forgotEmail.trim().toLowerCase(),
                    }),
                },
            );
            if (!res.ok) {
                throw new Error(`Request failed (${res.status})`);
            }
            setInfo(
                "If that email is registered, a reset link has been sent. (In dev, check the backend console.)",
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Request failed");
        } finally {
            setLoading(false);
        }
    }

    function handleGuest() {
        confirmGuest();
        setPopup(null);
        props.continuation?.();
    }

    return (
        <div className={Css.loginBox}>
            <div className={Css.loginForm}>
                <div className={Css.tabs}>
                    <button
                        className={classNames(Css.tab, {
                            [Css.tabActive!]: mode === "login",
                        })}
                        onClick={() => switchMode("login")}
                    >
                        Log in
                    </button>
                    <button
                        className={classNames(Css.tab, {
                            [Css.tabActive!]: mode === "signup",
                        })}
                        onClick={() => switchMode("signup")}
                    >
                        Sign up
                    </button>
                </div>

                {mode === "login" && (
                    <>
                        <label className={Css.field}>
                            <span>Username</span>
                            <input
                                type="text"
                                value={loginUsername}
                                onChange={(e) => setLoginUsername(e.target.value)}
                                className={Css.input}
                                autoCapitalize="none"
                                autoCorrect="off"
                            />
                        </label>
                        <label className={Css.field}>
                            <span>Password</span>
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                className={Css.input}
                            />
                        </label>
                        <button
                            className={Css.linkButton}
                            onClick={() => switchMode("forgot")}
                        >
                            Forgot password?
                        </button>
                        {error && <p className={Css.error}>{error}</p>}
                        <div className={Css.actions}>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.loginButton,
                                )}
                                onClick={handleLogin}
                                disabled={loading}
                            >
                                {loading ? "Logging in..." : "Log In"}
                            </button>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.guestButton,
                                )}
                                onClick={handleGuest}
                            >
                                Continue as Guest
                            </button>
                        </div>
                    </>
                )}

                {mode === "signup" && (
                    <>
                        <div className={Css.field}>
                            <span>I am a…</span>
                            <div className={Css.roleToggle}>
                                <button
                                    type="button"
                                    className={classNames(Css.roleOption, {
                                        [Css.roleOptionActive!]:
                                            signupRole === "student",
                                    })}
                                    onClick={() => setSignupRole("student")}
                                >
                                    Student
                                </button>
                                <button
                                    type="button"
                                    className={classNames(Css.roleOption, {
                                        [Css.roleOptionActive!]:
                                            signupRole === "advisor",
                                    })}
                                    onClick={() => setSignupRole("advisor")}
                                >
                                    Advisor
                                </button>
                            </div>
                        </div>
                        <label className={Css.field}>
                            <span>Username</span>
                            <input
                                type="text"
                                value={signupUsername}
                                onChange={(e) => setSignupUsername(e.target.value)}
                                className={Css.input}
                                autoCapitalize="none"
                                autoCorrect="off"
                                placeholder="3-32 chars, a-z 0-9 _"
                            />
                        </label>
                        <label className={Css.field}>
                            <span>Email (for password reset)</span>
                            <input
                                type="email"
                                value={signupEmail}
                                onChange={(e) => setSignupEmail(e.target.value)}
                                className={Css.input}
                            />
                        </label>
                        <label className={Css.field}>
                            <span>Password</span>
                            <input
                                type="password"
                                value={signupPassword}
                                onChange={(e) => setSignupPassword(e.target.value)}
                                className={Css.input}
                                placeholder="At least 8 characters"
                            />
                        </label>
                        <label className={Css.field}>
                            <span>College</span>
                            <select
                                value={signupSchool}
                                onChange={(e) =>
                                    setSignupSchool(e.target.value as APIv4.School)
                                }
                                className={Css.input}
                            >
                                {COLLEGES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {signupRole === "student" && (
                            <label className={Css.field}>
                                <span>Class Year</span>
                                <select
                                    value={signupClassYear}
                                    onChange={(e) =>
                                        setSignupClassYear(
                                            Number(e.target.value),
                                        )
                                    }
                                    className={Css.input}
                                >
                                    {SUPPORTED_CLASS_YEARS.map((y) => (
                                        <option key={y} value={y}>
                                            Class of {y} (
                                            {CLASS_YEAR_TO_CATALOG[y]} catalog)
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {error && <p className={Css.error}>{error}</p>}
                        <div className={Css.actions}>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.loginButton,
                                )}
                                onClick={handleSignup}
                                disabled={loading}
                            >
                                {loading ? "Creating..." : "Create Account"}
                            </button>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.guestButton,
                                )}
                                onClick={handleGuest}
                            >
                                Continue as Guest
                            </button>
                        </div>
                    </>
                )}

                {mode === "forgot" && (
                    <>
                        <h3 className={Css.formTitle}>Reset password</h3>
                        <p className={Css.hint}>
                            Enter the email associated with your account. If
                            it's registered, we'll send you a reset link.
                        </p>
                        <label className={Css.field}>
                            <span>Email</span>
                            <input
                                type="email"
                                value={forgotEmail}
                                onChange={(e) => setForgotEmail(e.target.value)}
                                className={Css.input}
                            />
                        </label>
                        {error && <p className={Css.error}>{error}</p>}
                        {info && <p className={Css.info}>{info}</p>}
                        <div className={Css.actions}>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.loginButton,
                                )}
                                onClick={handleForgot}
                                disabled={loading}
                            >
                                {loading ? "Sending..." : "Send reset link"}
                            </button>
                            <button
                                className={Css.linkButton}
                                onClick={() => switchMode("login")}
                            >
                                Back to log in
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
