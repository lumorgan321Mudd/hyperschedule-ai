import { memo, useCallback, useEffect, useState } from "react";
import Css from "./ManageAdvisors.module.css";
import AppCss from "@components/App.module.css";
import {
    apiDeleteAdvisorLink,
    apiGetAdvisorLinks,
    apiRequestAdvisorLink,
} from "@lib/api";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

export default memo(function ManageAdvisors() {
    const [links, setLinks] = useState<APIv4.AdvisorLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [username, setUsername] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const data = await apiGetAdvisorLinks();
            setLinks(data.asStudent);
        } catch {
            toast.error("Failed to load advisors");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRequest = useCallback(async () => {
        const u = username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(u)) {
            toast.error(
                "Username must be 3–32 lowercase letters, digits, or underscores",
            );
            return;
        }
        setSubmitting(true);
        try {
            await apiRequestAdvisorLink(u);
            toast.success("Request sent");
            setUsername("");
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to send request");
        }
        setSubmitting(false);
    }, [username, refresh]);

    const handleDelete = useCallback(
        async (linkId: string, isPending: boolean) => {
            const ok = window.confirm(
                isPending
                    ? "Cancel this pending request?"
                    : "Unlink from this advisor? You will need to request again to share schedules.",
            );
            if (!ok) return;
            try {
                await apiDeleteAdvisorLink(linkId);
                await refresh();
            } catch {
                toast.error("Failed to remove link");
            }
        },
        [refresh],
    );

    const accepted = links.filter((l) => l.status === "accepted");
    const pending = links.filter((l) => l.status === "pending");
    const rejected = links.filter((l) => l.status === "rejected");

    return (
        <div className={Css.container}>
            <h2>My advisors</h2>
            <p className={Css.description}>
                Link with your advisors so you can share schedules and graduation
                plans for approval. You'll need their username (which they
                created when signing up).
            </p>

            <div className={Css.requestRow}>
                <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Advisor username"
                    autoFocus
                    className={Css.input}
                />
                <button
                    className={classNames(AppCss.defaultButton, Css.requestButton)}
                    onClick={handleRequest}
                    disabled={submitting || username.trim().length === 0}
                >
                    {submitting ? "Sending..." : "Request link"}
                </button>
            </div>

            {loading ? (
                <p className={Css.empty}>Loading...</p>
            ) : (
                <>
                    <Section title="Accepted">
                        {accepted.length === 0 ? (
                            <p className={Css.empty}>No advisors linked yet.</p>
                        ) : (
                            accepted.map((l) => (
                                <LinkRow
                                    key={l._id}
                                    link={l}
                                    actionLabel="Unlink"
                                    onAction={() => handleDelete(l._id, false)}
                                />
                            ))
                        )}
                    </Section>

                    {pending.length > 0 && (
                        <Section title="Pending">
                            {pending.map((l) => (
                                <LinkRow
                                    key={l._id}
                                    link={l}
                                    actionLabel="Cancel"
                                    onAction={() => handleDelete(l._id, true)}
                                />
                            ))}
                        </Section>
                    )}

                    {rejected.length > 0 && (
                        <Section title="Rejected">
                            {rejected.map((l) => (
                                <LinkRow
                                    key={l._id}
                                    link={l}
                                    actionLabel="Remove"
                                    onAction={() => handleDelete(l._id, false)}
                                />
                            ))}
                        </Section>
                    )}
                </>
            )}
        </div>
    );
});

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className={Css.section}>
            <h3 className={Css.sectionTitle}>{title}</h3>
            {children}
        </div>
    );
}

function LinkRow({
    link,
    actionLabel,
    onAction,
}: {
    link: APIv4.AdvisorLink;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <div className={Css.row}>
            <div className={Css.rowMain}>
                <span className={Css.username}>{link.advisorUsername}</span>
                {link.advisorEmail && (
                    <span className={Css.email}>{link.advisorEmail}</span>
                )}
            </div>
            <button className={Css.rowAction} onClick={onAction}>
                {actionLabel}
            </button>
        </div>
    );
}
