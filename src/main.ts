import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { jsonBodyMiddleware } from "./common/json-body.middleware";
import { rawBodyMiddleware } from "./common/raw-body.middleware";

async function bootstrap(): Promise<void> {
  // The default body parser is disabled: `rawBodyMiddleware` below captures
  // the body as text for every route (the mock runtime needs the untouched
  // text to parse per-endpoint content type), and `jsonBodyMiddleware` then
  // JSON-parses that same text for the admin/auth routes only - see both
  // files for why a malformed body must not throw at this layer.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // This process sits behind the Next.js frontend's reverse proxy (and
  // possibly another edge in front of that), so Express's own req.protocol/
  // req.ip should trust X-Forwarded-*. `SessionService`/`publicOrigin()` also
  // check those headers directly rather than relying on this, but it keeps
  // any other Express-native accessor correct too.
  app.set("trust proxy", true);

  app.use(cookieParser());
  app.use(rawBodyMiddleware);
  app.use("/api/admin", jsonBodyMiddleware);
  app.use("/api/auth", jsonBodyMiddleware);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
   
  console.log(`[mock-api-studio-backend] listening on :${port}`);
}

void bootstrap();
