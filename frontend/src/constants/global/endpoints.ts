import { makeEndpoints } from "@shared/endpoints";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * The backend's URLs. Built by the shared factory so the web app and the extension
 * cannot end up with different paths for the same route — they previously did, and
 * only one of the two escaped the job id it interpolated.
 */
export const ENDPOINTS = makeEndpoints(API_URL);
