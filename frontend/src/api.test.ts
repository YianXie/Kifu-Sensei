/**
 * The axios instance's request/response interceptors.
 *
 * Requests are served by a stub adapter installed on `api.defaults.adapter`, so no
 * network or mock-server dependency is involved. The refresh call itself goes
 * through the bare `axios.post`, which is spied on separately.
 */
import axios, {
    AxiosError,
    AxiosHeaders,
    type AxiosRequestConfig,
    type AxiosResponse,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import api from "@/api";
import { ENDPOINTS } from "@/constants/global/endpoints";

type Adapter = NonNullable<AxiosRequestConfig["adapter"]>;

function response(
    config: AxiosRequestConfig,
    status: number,
    data: unknown = {}
): AxiosResponse {
    return {
        data,
        status,
        statusText: "",
        headers: new AxiosHeaders(),
        config: config as AxiosResponse["config"],
    };
}

/**
 * Install an adapter that answers 401 for the first `failures` calls and 200
 * afterwards, recording every config it saw.
 */
function installAdapter(failures: number): AxiosRequestConfig[] {
    const seen: AxiosRequestConfig[] = [];
    const adapter: Adapter = async (config) => {
        seen.push(config);
        if (seen.length <= failures) {
            const error = new AxiosError(
                "Unauthorized",
                "ERR_BAD_REQUEST",
                config
            );
            error.response = response(config, 401);
            error.config = config as AxiosError["config"];
            throw error;
        }
        return response(config, 200, { ok: true });
    };
    api.defaults.adapter = adapter;
    return seen;
}

function authHeaderOf(config: AxiosRequestConfig): unknown {
    // By the time the adapter sees it, axios has already normalised `headers`
    // into an AxiosHeaders instance; the declared type is the looser input type.
    return (config.headers as AxiosHeaders | undefined)?.Authorization;
}

beforeEach(() => {
    localStorage.clear();
    delete api.defaults.headers.common.Authorization;
});

describe("request interceptor", () => {
    it("attaches the stored access token", async () => {
        localStorage.setItem("access_token", "stored-access");
        const seen = installAdapter(0);

        await api.get("/anything");

        expect(authHeaderOf(seen[0])).toBe("Bearer stored-access");
    });

    it("sends no Authorization header when there is no token", async () => {
        const seen = installAdapter(0);

        await api.get("/anything");

        expect(authHeaderOf(seen[0])).toBeUndefined();
    });

    it("re-reads the token on every request", async () => {
        localStorage.setItem("access_token", "first");
        const seen = installAdapter(0);

        await api.get("/anything");
        localStorage.setItem("access_token", "second");
        await api.get("/anything");

        expect(authHeaderOf(seen[0])).toBe("Bearer first");
        expect(authHeaderOf(seen[1])).toBe("Bearer second");
    });
});

describe("response interceptor", () => {
    it("passes a successful response straight through", async () => {
        installAdapter(0);
        await expect(api.get("/anything")).resolves.toMatchObject({
            data: { ok: true },
        });
    });

    it("does not attempt a refresh for a non-401 failure", async () => {
        localStorage.setItem("refresh_token", "stored-refresh");
        const post = vi.spyOn(axios, "post");
        api.defaults.adapter = async (config) => {
            const error = new AxiosError(
                "Server error",
                "ERR_BAD_RESPONSE",
                config
            );
            error.response = response(config, 500);
            error.config = config as AxiosError["config"];
            throw error;
        };

        await expect(api.get("/anything")).rejects.toBeInstanceOf(AxiosError);
        expect(post).not.toHaveBeenCalled();
    });

    it("rejects a 401 without retrying when there is no refresh token", async () => {
        const post = vi.spyOn(axios, "post");
        const seen = installAdapter(1);

        await expect(api.get("/anything")).rejects.toBeInstanceOf(AxiosError);
        expect(post).not.toHaveBeenCalled();
        expect(seen).toHaveLength(1);
    });

    it("refreshes on a 401 and replays the original request", async () => {
        localStorage.setItem("access_token", "expired-access");
        localStorage.setItem("refresh_token", "stored-refresh");
        const post = vi
            .spyOn(axios, "post")
            .mockResolvedValue({ data: { access: "fresh-access" } });
        const seen = installAdapter(1);

        const result = await api.get("/anything");

        expect(post).toHaveBeenCalledWith(ENDPOINTS.tokenRefresh, {
            refresh: "stored-refresh",
        });
        expect(result.data).toEqual({ ok: true });
        expect(seen).toHaveLength(2);
        expect(authHeaderOf(seen[1])).toBe("Bearer fresh-access");
    });

    it("stores the refreshed access token", async () => {
        localStorage.setItem("refresh_token", "stored-refresh");
        vi.spyOn(axios, "post").mockResolvedValue({
            data: { access: "fresh-access" },
        });
        installAdapter(1);

        await api.get("/anything");

        expect(localStorage.getItem("access_token")).toBe("fresh-access");
    });

    it("stores the rotated refresh token too", async () => {
        // The backend rotates the refresh token on every use — losing it here
        // capped every session at a hard 7 days from login regardless of activity.
        localStorage.setItem("refresh_token", "stored-refresh");
        vi.spyOn(axios, "post").mockResolvedValue({
            data: { access: "fresh-access", refresh: "fresh-refresh" },
        });
        installAdapter(1);

        await api.get("/anything");

        expect(localStorage.getItem("refresh_token")).toBe("fresh-refresh");
    });

    it("leaves the stored refresh token alone if the response omits one", async () => {
        localStorage.setItem("refresh_token", "stored-refresh");
        vi.spyOn(axios, "post").mockResolvedValue({
            data: { access: "fresh-access" },
        });
        installAdapter(1);

        await api.get("/anything");

        expect(localStorage.getItem("refresh_token")).toBe("stored-refresh");
    });

    it("retries only once, so a still-401 replay does not loop", async () => {
        localStorage.setItem("refresh_token", "stored-refresh");
        vi.spyOn(axios, "post").mockResolvedValue({
            data: { access: "fresh-access" },
        });
        const seen = installAdapter(Infinity);

        await expect(api.get("/anything")).rejects.toBeInstanceOf(AxiosError);
        expect(seen).toHaveLength(2);
    });

    it("clears the session and redirects to /login when the refresh is rejected", async () => {
        localStorage.setItem("access_token", "expired-access");
        localStorage.setItem("refresh_token", "dead-refresh");
        vi.spyOn(axios, "post").mockRejectedValue(
            new AxiosError("Unauthorized", "ERR_BAD_REQUEST")
        );
        installAdapter(1);
        // jsdom refuses to navigate, so `window.location` is replaced wholesale.
        const location = { href: "" } as Location;
        vi.spyOn(window, "location", "get").mockReturnValue(location);

        await expect(api.get("/anything")).rejects.toBeInstanceOf(AxiosError);

        expect(localStorage.getItem("access_token")).toBeNull();
        expect(localStorage.getItem("refresh_token")).toBeNull();
        expect(location.href).toBe("/login");
    });

    it("refreshes once for concurrent 401s and replays both", async () => {
        // Without the queue, every in-flight request would fire its own refresh
        // and all but one of the resulting tokens would be discarded.
        localStorage.setItem("refresh_token", "stored-refresh");
        let resolveRefresh: (value: unknown) => void = () => {};
        const post = vi.spyOn(axios, "post").mockReturnValue(
            new Promise((resolve) => {
                resolveRefresh = resolve;
            }) as ReturnType<typeof axios.post>
        );

        const seen: AxiosRequestConfig[] = [];
        const failed = new Set<string>();
        api.defaults.adapter = async (config) => {
            seen.push(config);
            const key = String(config.url);
            if (!failed.has(key)) {
                failed.add(key);
                const error = new AxiosError(
                    "Unauthorized",
                    "ERR_BAD_REQUEST",
                    config
                );
                error.response = response(config, 401);
                error.config = config as AxiosError["config"];
                throw error;
            }
            return response(config, 200, { url: config.url });
        };

        const both = Promise.all([api.get("/first"), api.get("/second")]);
        // Let both requests reach the interceptor before the refresh settles.
        await Promise.resolve();
        await Promise.resolve();
        resolveRefresh({ data: { access: "fresh-access" } });
        const [first, second] = await both;

        expect(post).toHaveBeenCalledTimes(1);
        expect(first.data).toEqual({ url: "/first" });
        expect(second.data).toEqual({ url: "/second" });
        expect(
            seen
                .slice(2)
                .every(
                    (config) => authHeaderOf(config) === "Bearer fresh-access"
                )
        ).toBe(true);
    });
});

describe("endpoints", () => {
    it("derives every URL from the same base", () => {
        const base = ENDPOINTS.tokenObtain.replace("/auth/token/", "");
        expect(ENDPOINTS.tokenRefresh).toBe(`${base}/auth/token/refresh/`);
        expect(ENDPOINTS.userSettings).toBe(`${base}/auth/user/settings/`);
        expect(ENDPOINTS.commentary).toBe(`${base}/api/commentary/`);
        expect(ENDPOINTS.commentaryJobs).toBe(`${base}/api/commentary/jobs/`);
    });

    it("builds a per-job polling URL", () => {
        expect(ENDPOINTS.commentaryJob("abc123")).toBe(
            `${ENDPOINTS.commentaryJobs}abc123/`
        );
    });
});
