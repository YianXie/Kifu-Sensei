/**
 * Whether to play the stone sound when stepping through moves. Defaults to on,
 * so an account saved before the preference existed keeps the old behaviour.
 */
export function readPlayStoneSound(
    preferences: Record<string, unknown> | null | undefined
): boolean {
    return preferences?.play_stone_sound !== false;
}
