import type { NextFunction, Request, Response } from "express";

/**
 * Reads the request body exactly once, as text, onto `req.rawBody` - nothing
 * parses it here. Applied globally, ahead of routing, because two different
 * things need the SAME raw text afterwards: the mock runtime parses it per the
 * registered endpoint's content type (JSON, form-urlencoded, XML/SOAP/plain
 * text carried verbatim), while `jsonBody()` below JSON-parses it for the
 * admin/auth routes. Neither can work from an already-consumed stream, and
 * Node's request stream can only be read once.
 */
export function rawBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD") {
    req.rawBody = "";
    next();
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks).toString("utf8");
    next();
  });
  req.on("error", () => {
    req.rawBody = "";
    next();
  });
}
