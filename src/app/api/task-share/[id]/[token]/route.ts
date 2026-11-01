import { shareJson, shareStore } from "@/lib/task-share-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await context.params;
  try {
    const share = await shareStore().read(id, token);
    return share ? shareJson(share) : shareJson({ error: "Share not found." }, 404);
  } catch { return shareJson({ error: "Task sharing is unavailable." }, 503); }
}
