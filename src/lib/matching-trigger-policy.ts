export function shouldTriggerMatchesAfterTransition(action: string): boolean {
  return action === "decline" || action === "cancel" || action === "resume";
}

export async function triggerMatchesBestEffort(
  trigger: () => Promise<unknown>,
  isRecoverable: (error: unknown) => boolean,
): Promise<boolean> {
  try {
    await trigger();
    return false;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
    return true;
  }
}
