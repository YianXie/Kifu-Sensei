import { describe, expect, it } from "vitest";

import { getExtensionAuth, isAuthenticated } from "./auth";
import { AUTH_STORAGE_KEY } from "./constants";

const AUTH = { accessToken: "access-1", refreshToken: "refresh-1" };

describe("getExtensionAuth", () => {
    it("reads the pair the website wrote to localStorage", () => {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(AUTH));
        expect(getExtensionAuth()).toEqual(AUTH);
    });

    it("returns null when the website has written nothing", () => {
        expect(getExtensionAuth()).toBeNull();
    });

    it("throws on a corrupt entry rather than returning a half-read session", () => {
        localStorage.setItem(AUTH_STORAGE_KEY, "{not json");
        expect(() => getExtensionAuth()).toThrow();
    });
});

describe("isAuthenticated", () => {
    it("is true once the handoff entry exists", () => {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(AUTH));
        expect(isAuthenticated()).toBe(true);
    });

    it("is false when it does not", () => {
        expect(isAuthenticated()).toBe(false);
    });
});
