export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.VERCEL !== "1" && process.env.LOCAL_SCHEDULER === "true") {
      const { startLocalSchedulers } = await import("@/lib/jobs/localScheduler");
      await startLocalSchedulers();
    }
  }
}
