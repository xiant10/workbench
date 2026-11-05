import { type InfiniteData, type QueryKey, useInfiniteQuery } from "@tanstack/react-query";
import { useI18n } from "./i18n.tsx";

/** One page of a cursor-paged list. An empty or missing `next` is the last page. */
export type Page<T> = { items: T[]; next?: string };

type Options<T> = { refetchInterval?: number | false | ((items: T[] | undefined) => number | false); enabled?: boolean; gcTime?: number };

/**
 * A long list read a page at a time: the first page loads, the rest wait for
 * `loadMore`. `data` is every loaded page joined, so callers read it like a
 * plain query's.
 */
export function usePaged<T>(queryKey: QueryKey, fetchPage: (cursor: string) => Promise<Page<T>>, { refetchInterval, ...options }: Options<T> = {}) {
	const query = useInfiniteQuery<Page<T>, Error, InfiniteData<Page<T>, string>, QueryKey, string>({
		queryKey,
		queryFn: ({ pageParam }) => fetchPage(pageParam),
		initialPageParam: "",
		getNextPageParam: (last: Page<T>) => last.next || undefined,
		...(refetchInterval === undefined
			? {}
			: { refetchInterval: typeof refetchInterval === "function" ? (q) => refetchInterval(Array.isArray(q.state.data?.pages) ? q.state.data.pages.flatMap((page) => page?.items ?? []) : undefined) : refetchInterval }),
		...options,
	});
	return {
		data: Array.isArray(query.data?.pages) ? query.data.pages.flatMap((page) => page?.items ?? []) : undefined,
		isPending: query.isPending,
		isSuccess: query.isSuccess,
		isError: query.isError,
		refetch: query.refetch,
		hasMore: query.hasNextPage,
		loadingMore: query.isFetchingNextPage,
		loadMore: () => void query.fetchNextPage(),
	};
}

export type Paged<T> = ReturnType<typeof usePaged<T>>;

/** The button under a paged list. It draws nothing once everything is loaded. */
export function LoadMore({ list, label = "Load more", className = "ghost small load-more" }: { list: Pick<Paged<unknown>, "hasMore" | "loadingMore" | "loadMore">; label?: string; className?: string }) {
	const { t } = useI18n();
	if (!list.hasMore) return null;
	return (
		<button type="button" className={className} disabled={list.loadingMore} onClick={list.loadMore}>
			{t(list.loadingMore ? "Loading…" : label)}
		</button>
	);
}
