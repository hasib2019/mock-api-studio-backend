/**
 * Maps an incoming `/api/mock/<slug>/<...path>` request onto a registered
 * project + endpoint, capturing `:param` segments along the way. Ported from
 * the original Next.js studio's `src/lib/matcher.ts`; only the storage lookup
 * changes (injected `ProjectsService`/`EndpointsService` instead of bare
 * imported functions).
 */
import { Injectable } from "@nestjs/common";

import { normalizePath } from "../common/ids";
import { ProjectsService } from "../projects/projects.service";
import { EndpointsService } from "../endpoints/endpoints.service";
import type { EndpointDef, HttpMethod, ProjectDef } from "../common/types";

export interface ResolvedRoute {
  project: ProjectDef;
  endpoint: EndpointDef;
  params: Record<string, string>;
}

export type RouteResolution =
  | { kind: "ok"; route: ResolvedRoute }
  | { kind: "project_not_found"; slug: string }
  | { kind: "no_route"; slug: string; path: string; methodMismatch?: HttpMethod[] };

/* ------------------------------------------------------------------ *
 * Path matching
 * ------------------------------------------------------------------ */

function splitSegments(input: string): string[] {
  return (input || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function paramName(segment: string): string | null {
  if (segment.length > 1 && segment.startsWith(":")) return segment.slice(1);
  if (segment.length > 2 && segment.startsWith("{") && segment.endsWith("}")) {
    return segment.slice(1, -1);
  }
  return null;
}

/**
 * `matchPath("/accounts/:accountNumber/balance", "/accounts/123/balance")`
 * gives `{ accountNumber: "123" }`. A trailing `*` swallows the rest of the
 * path into `{ wildcard }`. Static segments compare case-insensitively.
 * Returns null when the pattern does not apply.
 */
export function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const patternSegments = splitSegments(pattern);
  const actualSegments = splitSegments(actual);
  const hasWildcard = patternSegments[patternSegments.length - 1] === "*";
  const fixedCount = hasWildcard ? patternSegments.length - 1 : patternSegments.length;

  if (hasWildcard) {
    if (actualSegments.length < fixedCount) return null;
  } else if (actualSegments.length !== patternSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < fixedCount; i++) {
    const expected = patternSegments[i];
    const received = actualSegments[i];
    const name = paramName(expected);
    if (name) {
      params[name] = received;
      continue;
    }
    if (expected === "*") continue;
    if (expected.toLowerCase() !== received.toLowerCase()) return null;
  }

  if (hasWildcard) params.wildcard = actualSegments.slice(fixedCount).join("/");
  return params;
}

function countParams(pattern: string): number {
  return splitSegments(pattern).filter((segment) => paramName(segment) !== null).length;
}

function hasWildcardSegment(pattern: string): boolean {
  const segments = splitSegments(pattern);
  return segments[segments.length - 1] === "*";
}

interface Candidate {
  endpoint: EndpointDef;
  params: Record<string, string>;
  wildcard: boolean;
  paramCount: number;
  order: number;
}

@Injectable()
export class MatcherService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly endpoints: EndpointsService,
  ) {}

  /**
   * `segments` is the catch-all path after `/api/mock/`: the first entry is
   * the project slug, the rest is the endpoint path.
   *
   * Matching is done on path + method only; a *disabled* endpoint still
   * resolves so the runtime can answer 503 instead of 404. When the path
   * exists but carries no handler for this method, `methodMismatch` lists the
   * methods that do exist there.
   */
  async resolveRoute(method: string, segments: string[]): Promise<RouteResolution> {
    const slug = (segments[0] ?? "").trim();
    const path = normalizePath(segments.slice(1).join("/"));

    if (!slug) return { kind: "project_not_found", slug };

    const project = await this.projects.getProjectBySlug(slug);
    if (!project) return { kind: "project_not_found", slug };

    const endpoints = await this.endpoints.listEndpoints(project.id);
    const candidates: Candidate[] = [];

    endpoints.forEach((endpoint, order) => {
      const params = matchPath(endpoint.path, path);
      if (!params) return;
      candidates.push({
        endpoint,
        params,
        wildcard: hasWildcardSegment(endpoint.path),
        paramCount: countParams(endpoint.path),
        order,
      });
    });

    if (candidates.length === 0) return { kind: "no_route", slug, path };

    const wanted = (method || "").toUpperCase();
    const matches = candidates.filter((candidate) => candidate.endpoint.method === wanted);

    if (matches.length === 0) {
      const methodMismatch: HttpMethod[] = [];
      for (const candidate of candidates) {
        if (!methodMismatch.includes(candidate.endpoint.method)) {
          methodMismatch.push(candidate.endpoint.method);
        }
      }
      return { kind: "no_route", slug, path, methodMismatch };
    }

    // Exact static beats parameterised, fewer params beats more, a wildcard is
    // the last resort, and an enabled endpoint wins a tie against a disabled one.
    matches.sort((a, b) => {
      if (a.wildcard !== b.wildcard) return a.wildcard ? 1 : -1;
      if (a.paramCount !== b.paramCount) return a.paramCount - b.paramCount;
      const aEnabled = a.endpoint.enabled !== false;
      const bEnabled = b.endpoint.enabled !== false;
      if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
      return a.order - b.order;
    });

    const best = matches[0];
    return { kind: "ok", route: { project, endpoint: best.endpoint, params: best.params } };
  }
}
