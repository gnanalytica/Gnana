export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  ...args: Parameters<NonNullable<typeof import("next/server").onRequestError>>
) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  return captureRequestError(...args);
};
