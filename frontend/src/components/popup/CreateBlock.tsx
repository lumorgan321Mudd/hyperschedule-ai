import { memo, useState, useCallback, useEffect } from "react";
import Css from "./CreateBlock.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch, fetchWithToast, schoolCodeFromEnum } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

const COLLEGES: { value: APIv4.School; label: string }[] = [
    { value: APIv4.School.HMC, label: "Harvey Mudd College" },
    { value: APIv4.School.POM, label: "Pomona College" },
    { value: APIv4.School.SCR, label: "Scripps College" },
    { value: APIv4.School.CMC, label: "Claremont McKenna College" },
    { value: APIv4.School.PTZ, label: "Pitzer College" },
];

const CLASS_YEARS = APIv4.SUPPORTED_CLASS_YEARS;

export default memo(function CreateBlock() {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);
    const server = useUserStore((store) => store.server);

    const [name, setName] = useState("");
    const [classYear, setClassYear] = useState<number>(
        server?.classYear ?? CLASS_YEARS[CLASS_YEARS.length - 1] ?? 2029,
    );
    const [college, setCollege] = useState<APIv4.School>(
        server?.school ?? APIv4.School.HMC,
    );
    const [major, setMajor] = useState("");
    const [majors, setMajors] = useState<{ key: string; name: string }[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const catalogYear = APIv4.CLASS_YEAR_TO_CATALOG[classYear] ?? APIv4.DEFAULT_CATALOG_YEAR;

    // Fetch available majors when college or catalog year changes
    useEffect(() => {
        const code = schoolCodeFromEnum(college);
        fetchWithToast(
            `${__API_URL__}/v4/major-requirements/${code}/${catalogYear}`,
            { credentials: "include", cache: "no-cache" },
        )
            .then((r) => (r.ok ? r.json() : null))
            .then(
                (
                    data: {
                        majors: Record<string, { name: string }>;
                    } | null,
                ) => {
                    if (data?.majors) {
                        const entries = Object.entries(data.majors).map(
                            ([key, m]) => ({ key, name: m.name }),
                        );
                        setMajors(entries);
                        if (entries.some((e) => e.key === "engineering")) {
                            setMajor("engineering");
                        }
                    } else {
                        setMajors([]);
                    }
                },
            )
            .catch(() => setMajors([]));
    }, [college, catalogYear]);

    const handleCreate = useCallback(async () => {
        if (!name.trim()) {
            toast.error("Please enter a plan name");
            return;
        }
        setSubmitting(true);
        try {
            await apiFetch.createBlock({
                name: name.trim(),
                college,
                catalogYear,
                ...(major ? { major } : {}),
            });
            await getUser();
            setPopup(null);
            toast.success("Plan created!");
        } catch {
            toast.error("Failed to create plan");
        }
        setSubmitting(false);
    }, [name, college, major, catalogYear, getUser, setPopup]);

    return (
        <div className={Css.container}>
            <h2>Create Graduation Plan</h2>
            <label>
                Plan Name:
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., My 4-Year CS Plan"
                    maxLength={100}
                    autoFocus
                />
            </label>
            <label>
                Class Year:
                <select
                    value={classYear}
                    onChange={(e) => setClassYear(Number(e.target.value))}
                >
                    {CLASS_YEARS.map((y) => (
                        <option key={y} value={y}>
                            Class of {y} ({APIv4.CLASS_YEAR_TO_CATALOG[y]}{" "}
                            catalog)
                        </option>
                    ))}
                </select>
            </label>
            <label>
                College:
                <select
                    value={college}
                    onChange={(e) =>
                        setCollege(e.target.value as APIv4.School)
                    }
                >
                    {COLLEGES.map((c) => (
                        <option key={c.value} value={c.value}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Major:
                <select
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                >
                    <option value="">None</option>
                    {majors.map((m) => (
                        <option key={m.key} value={m.key}>
                            {m.name}
                        </option>
                    ))}
                </select>
            </label>
            <button
                className={classNames(AppCss.defaultButton, Css.createButton)}
                onClick={handleCreate}
                disabled={submitting}
            >
                {submitting ? "Creating..." : "Create Plan"}
            </button>
        </div>
    );
});
