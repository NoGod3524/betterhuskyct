import { handleShareWrite } from "@/lib/task-share-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleShareWrite(request);
