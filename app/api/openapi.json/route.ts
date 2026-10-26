import { openApiDocument } from "@/lib/openapi";
export function GET() {
  return Response.json(openApiDocument(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="ervisiodrive-openapi.json"',
    },
  });
}
