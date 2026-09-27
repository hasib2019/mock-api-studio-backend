// Augments Express's Request with the raw body text `RawBodyMiddleware` reads
// before any parsing happens - the mock runtime needs the untouched text to
// parse per-endpoint content type; the JSON body middleware re-parses the
// same text for the admin/auth routes.
import "express";

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: string;
  }
}
