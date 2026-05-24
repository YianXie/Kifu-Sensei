import { useEffect } from "react";

export function usePageTitle(title: string) {
    useEffect(() => {
        const previous = document.title;
        document.title = title ? `${title} | Website Template` : "Website Template";
        return () => {
            document.title = previous;
        };
    }, [title]);
}
