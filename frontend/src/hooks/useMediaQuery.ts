import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. Returns `false` during SSR-less first paint
 * only if `matchMedia` is unavailable, which in practice means jsdom without the
 * shim in `src/test/setup.ts`.
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(
        () => window.matchMedia?.(query).matches ?? false
    );

    useEffect(() => {
        const list = window.matchMedia?.(query);
        if (!list) return;
        setMatches(list.matches);
        const onChange = (event: MediaQueryListEvent) =>
            setMatches(event.matches);
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
    }, [query]);

    return matches;
}
