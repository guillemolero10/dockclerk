/**
 * A mistake the person can fix ("type 1 to 66 pallets"). Server actions return it as `{ error }` instead of throwing,
 * because in production Next replaces the message of a thrown error with a generic one.
 */
export class Fixable extends Error {}

/** Runs a server action body: `{}` when it worked, `{ error }` for a Fixable; anything else is still thrown. */
export async function orFixable(run: () => Promise<void>): Promise<{ error?: string }> {
  try {
    await run();
    return {};
  } catch (error) {
    if (error instanceof Fixable) return { error: error.message };
    throw error;
  }
}
