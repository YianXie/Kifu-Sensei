import { AxiosError } from "axios";

export function getErrorMessage(error: unknown, fallback = "An unexpected error occurred."): string {
    if (error instanceof AxiosError) {
        const data = error.response?.data;
        if (!data) return fallback;

        // DRF non-field errors
        if (typeof data.detail === "string") return data.detail;

        // DRF field errors — flatten to first message
        if (typeof data === "object") {
            const firstKey = Object.keys(data)[0];
            if (firstKey) {
                const val = data[firstKey];
                const msg = Array.isArray(val) ? val[0] : val;
                return `${firstKey}: ${msg}`;
            }
        }
    }
    if (error instanceof Error) return error.message;
    return fallback;
}
