// Stub for the /design-sync bundle. The real module imports a .wav asset,
// which esbuild has no loader for; audio is a runtime-only concern that never
// affects how a component renders. Controls only touches .currentTime / .play().
const placeStoneSoundInstance = {
    currentTime: 0,
    play(): void {},
};

export default placeStoneSoundInstance;
