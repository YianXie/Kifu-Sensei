import { useEffect } from "react";

export function usePageTitle(title: string) {
    useEffect(() => {
        const previous = document.title;
        document.title = title ? `${title} | Kifu-Sensei` : "Kifu-Sensei";
        return () => {
            document.title = previous;
        };
    }, [title]);
}
