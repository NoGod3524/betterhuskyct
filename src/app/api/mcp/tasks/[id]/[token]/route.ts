import { handleTaskMcp } from "@/lib/task-share-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; token: string }> };
export async function POST(request: Request, context: Context) {
  const { id, token } = await context.params;
  return handleTaskMcp(request, id, token);
}
export async function GET(request: Request, context: Context) {
  const { id, token } = await context.params;
  return handleTaskMcp(request, id, token);
}
