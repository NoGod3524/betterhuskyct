import { handleShareWrite } from "@/lib/task-share-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) { return handleShareWrite(request, (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return handleShareWrite(request, (await context.params).id); }
