import { useSectionsQuery } from "@hooks/api/query";

import { useMemo } from "react";

import * as APIv4 from "hyperschedule-shared/api/v4";
import { useUserStore } from "@hooks/store/user";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";

export function useActiveSectionsQuery(): APIv4.Section[] | undefined {
    const activeTerm = useUserStore((store) => store.activeTerm);
    return useSectionsQuery(activeTerm).data;
}

// returns a map of section identifier strings to sections
export function useActiveSectionsLookup(): Map<string, APIv4.Section> {
    const sectionsQuery = useActiveSectionsQuery();

    return useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();

        if (!sectionsQuery) return lookup;
        for (const section of sectionsQuery)
            lookup.set(
                APIv4.stringifySectionCodeLong(section.identifier),
                section,
            );

        return lookup;
    }, [sectionsQuery]);
}

// Lookup keyed off the active schedule's term — sections in the sidebar/calendar
// belong to the schedule's term, which is not always the user's active term
// (e.g. viewing a past-semester schedule).
export function useScheduleSectionsLookup(): Map<string, APIv4.Section> {
    const activeScheduleId = useUserStore((store) => store.activeScheduleId);
    const schedules = useUserStore((store) => store.schedules);
    const term =
        (activeScheduleId !== null && schedules[activeScheduleId]?.term) ||
        CURRENT_TERM;
    const { data } = useSectionsQuery(term);

    return useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();
        if (!data) return lookup;
        for (const section of data)
            lookup.set(
                APIv4.stringifySectionCodeLong(section.identifier),
                section,
            );
        return lookup;
    }, [data]);
}
