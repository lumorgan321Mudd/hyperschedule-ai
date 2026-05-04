import * as APIv4 from "hyperschedule-shared/api/v4";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
    getAllTerms,
    getSectionsForTerm,
    getCourseAreaDescription,
    getOfferingHistory,
    getSectionsForTerms,
} from "@hooks/api/fetch";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import * as ReactQuery from "@tanstack/react-query";

export const queryClient = new ReactQuery.QueryClient({
    defaultOptions: {
        queries: {
            networkMode: "offlineFirst",
            gcTime: Infinity,
            retry: 1,
        },
    },
});

export function useAllTermsQuery(): UseQueryResult<APIv4.TermIdentifier[]> {
    return useQuery({
        queryKey: ["all terms"],
        queryFn: getAllTerms,
        staleTime: 10 * 60 * 1000,
        refetchInterval: 30 * 60 * 1000,
    });
}

export function useSectionsQuery(
    term: APIv4.TermIdentifier,
): UseQueryResult<APIv4.Section[]> {
    let timeout = 30 * 1000;
    if (APIv4.termIsBefore(term, CURRENT_TERM)) timeout = 60 * 60 * 1000;

    return useQuery({
        queryKey: ["sections", term] as const,
        queryFn: (ctx) => getSectionsForTerm(ctx.queryKey[1]!),
        staleTime: timeout,
        refetchInterval: timeout,
    });
}

export function useSectionsForTermsQuery(
    enabled: boolean,
    terms: APIv4.TermIdentifier[],
): UseQueryResult<APIv4.Section[]> {
    let timeout = terms.length * 30 * 1000;

    return useQuery({
        queryKey: ["sections", "historical", terms] as const,
        queryFn: (ctx) => getSectionsForTerms(ctx.queryKey[2]!),
        staleTime: timeout,
        refetchInterval: timeout,
        enabled: enabled,
    });
}

export function useCourseAreaDescription(): UseQueryResult<
    Map<string, string>
> {
    return useQuery({
        queryKey: ["course areas"],
        queryFn: getCourseAreaDescription,
        staleTime: 24 * 60 * 60 * 1000, // 1 day
        refetchInterval: 24 * 60 * 60 * 1000,
    });
}

export function useOfferingHistory(
    terms: APIv4.TermIdentifier[],
): UseQueryResult<APIv4.OfferingHistory[]> {
    return useQuery({
        queryKey: ["offering history", terms] as const,
        queryFn: (ctx) => getOfferingHistory(ctx.queryKey[1]!),
        staleTime: 24 * 60 * 60 * 1000, // 1 day
        gcTime: 24 * 60 * 60 * 1000,
        refetchInterval: 24 * 60 * 60 * 1000,
    });
}

export interface TagOption {
    value: string;
    label: string;
    group: string;
}

interface SchoolReqData {
    general_requirements?: Array<{
        name?: string;
        subCategories?: Array<{ tagValue?: string; name?: string }>;
    }>;
    majors?: Record<
        string,
        {
            name: string;
            major_courses?: {
                electives?: { tagValue?: string; description?: string };
            };
        }
    >;
}

function humanizeTag(tag: string): string {
    return tag
        .split("-")
        .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
        .join(" ");
}

export function useSchoolTagOptions(
    schoolCode: string | undefined,
    catalogYear: string | undefined,
): UseQueryResult<TagOption[]> {
    return useQuery({
        queryKey: ["school tags", schoolCode, catalogYear] as const,
        enabled: !!schoolCode && !!catalogYear,
        staleTime: 24 * 60 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        queryFn: async () => {
            const res = await fetch(
                `${__API_URL__}/v4/major-requirements/${schoolCode}/${catalogYear}`,
                { cache: "no-cache" },
            );
            if (!res.ok) return [];
            const data: SchoolReqData = await res.json();
            const seen = new Set<string>();
            const options: TagOption[] = [];

            for (const group of data.general_requirements ?? []) {
                for (const sub of group.subCategories ?? []) {
                    if (sub.tagValue && !seen.has(sub.tagValue)) {
                        seen.add(sub.tagValue);
                        const groupName = group.name ?? "General";
                        options.push({
                            value: sub.tagValue,
                            label: sub.name ?? humanizeTag(sub.tagValue),
                            group: groupName,
                        });
                    }
                }
            }

            for (const [, major] of Object.entries(data.majors ?? {})) {
                const electives = major.major_courses?.electives;
                if (electives?.tagValue && !seen.has(electives.tagValue)) {
                    seen.add(electives.tagValue);
                    options.push({
                        value: electives.tagValue,
                        label: humanizeTag(electives.tagValue),
                        group: `${major.name} Electives`,
                    });
                }
            }

            return options;
        },
    });
}
