/**
 * Endpoints - ported from the original Next.js studio's `src/lib/store.ts`.
 * Depends on `ProjectsService` (existence checks) exactly as the original
 * kept both concerns in one file - see `../store.module.ts` for why they stay
 * in one Nest module instead of two that would import each other.
 */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { EndpointEntity } from "../database/entities/endpoint.entity";
import { isUniqueViolation } from "../database/pg-helpers";
import { withLock } from "../common/lock";
import { isRecord } from "../common/http";
import { newId, normalizePath } from "../common/ids";
import { newEndpoint } from "../common/defaults";
import {
  asArray,
  cloneJson,
  parseMethod,
  requireText,
  str,
  stripUndefined,
  validId,
} from "../common/store-helpers";
import { StoreError } from "../common/store-error";
import { HTTP_METHODS } from "../common/types";
import type {
  Condition,
  EndpointDef,
  EndpointInput,
  ErrorTemplate,
  FieldDef,
  HttpMethod,
  RequestSpec,
  ResponseScenario,
  ValidationRule,
} from "../common/types";
import { ProjectsService } from "../projects/projects.service";

const ENDPOINTS_LOCK = "store:endpoints";

@Injectable()
export class EndpointsService {
  constructor(
    @InjectRepository(EndpointEntity) private readonly endpoints: Repository<EndpointEntity>,
    private readonly projects: ProjectsService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Hydration
   * ------------------------------------------------------------------ */

  private hydrateEndpoint(raw: unknown): EndpointDef | null {
    if (!isRecord(raw)) return null;
    const id = str(raw.id).trim();
    const projectId = str(raw.projectId).trim();
    if (!id || !projectId) return null;

    const base = newEndpoint(projectId, { ...(raw as unknown as Partial<EndpointDef>), id });
    return {
      ...base,
      method: (HTTP_METHODS.find((m) => m === base.method) ?? "POST") as HttpMethod,
      path: normalizePath(base.path),
      auth: isRecord(base.auth) ? base.auth : { type: "none" },
      request: {
        ...base.request,
        body: asArray<FieldDef>(base.request.body),
        query: asArray<FieldDef>(base.request.query),
        headers: asArray<FieldDef>(base.request.headers),
      },
      scenarios: asArray<ResponseScenario>(base.scenarios),
      tags: asArray<string>(base.tags),
    };
  }

  private async readAllEndpoints(): Promise<EndpointDef[]> {
    const rows = await this.endpoints.find();
    return rows
      .map((row) => this.hydrateEndpoint(row.data))
      .filter((e): e is EndpointDef => e !== null);
  }

  private methodRank(method: HttpMethod): number {
    const index = HTTP_METHODS.indexOf(method);
    return index === -1 ? HTTP_METHODS.length : index;
  }

  /* ------------------------------------------------------------------ *
   * Reads
   * ------------------------------------------------------------------ */

  async listEndpoints(projectId?: string): Promise<EndpointDef[]> {
    const wanted = str(projectId).trim();
    const rows = wanted
      ? await this.endpoints.find({ where: { projectId: wanted } })
      : await this.endpoints.find();
    const list = rows.map((row) => this.hydrateEndpoint(row.data)).filter((e): e is EndpointDef => e !== null);
    return list.sort(
      (a, b) => a.path.localeCompare(b.path) || this.methodRank(a.method) - this.methodRank(b.method),
    );
  }

  async getEndpoint(id: string): Promise<EndpointDef | null> {
    const recordId = validId(str(id).trim());
    if (!recordId) return null;
    const row = await this.endpoints.findOneBy({ id: recordId });
    return row ? this.hydrateEndpoint(row.data) : null;
  }

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  async createEndpoint(input: EndpointInput): Promise<EndpointDef> {
    const projectId = requireText(input.projectId, "Project id");
    const project = await this.projects.getProject(projectId);
    if (!project) throw new StoreError(`Project "${projectId}" not found`, 404);

    return withLock(ENDPOINTS_LOCK, async () => {
      const method = parseMethod(input.method, "POST");
      const endpointPath = normalizePath(str(input.path));
      const existing = await this.readAllEndpoints();

      if (
        existing.some(
          (endpoint) =>
            endpoint.projectId === project.id &&
            endpoint.method === method &&
            endpoint.path === endpointPath,
        )
      ) {
        throw new StoreError(`${method} ${endpointPath} is already registered in this project`, 409);
      }

      const id = str(input.id).trim() || newId("ep");
      const recordId = validId(id);
      if (!recordId) throw new StoreError("Invalid endpoint id", 400);
      if (existing.some((endpoint) => endpoint.id === recordId)) {
        throw new StoreError(`Endpoint "${recordId}" already exists`, 409);
      }

      const now = new Date().toISOString();
      const endpoint = newEndpoint(project.id, {
        ...input,
        id: recordId,
        name: str(input.name).trim() || "Untitled endpoint",
        method,
        path: endpointPath,
        createdAt: now,
        updatedAt: now,
      });

      try {
        await this.endpoints.insert({
          id: endpoint.id,
          projectId: endpoint.projectId,
          method: endpoint.method,
          path: endpoint.path,
          data: endpoint,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError(`${method} ${endpointPath} is already registered in this project`, 409);
        }
        throw error;
      }
      return endpoint;
    });
  }

  async updateEndpoint(id: string, patch: Partial<EndpointDef>): Promise<EndpointDef> {
    return withLock(ENDPOINTS_LOCK, async () => {
      const recordId = validId(str(id).trim());
      const current = recordId ? await this.getEndpoint(recordId) : null;
      if (!recordId || !current) throw new StoreError("Endpoint not found", 404);

      const clean = stripUndefined(patch);
      const projectId =
        "projectId" in clean ? requireText(clean.projectId, "Project id") : current.projectId;
      if (projectId !== current.projectId && !(await this.projects.getProject(projectId))) {
        throw new StoreError(`Project "${projectId}" not found`, 404);
      }

      const method = "method" in clean ? parseMethod(clean.method, current.method) : current.method;
      const endpointPath = "path" in clean ? normalizePath(str(clean.path)) : current.path;
      const name = "name" in clean ? str(clean.name).trim() || current.name : current.name;

      if (method !== current.method || endpointPath !== current.path || projectId !== current.projectId) {
        const existing = await this.readAllEndpoints();
        if (
          existing.some(
            (endpoint) =>
              endpoint.id !== current.id &&
              endpoint.projectId === projectId &&
              endpoint.method === method &&
              endpoint.path === endpointPath,
          )
        ) {
          throw new StoreError(`${method} ${endpointPath} is already registered in this project`, 409);
        }
      }

      const next: EndpointDef = {
        ...current,
        ...clean,
        id: current.id,
        projectId,
        name,
        method,
        path: endpointPath,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };

      try {
        await this.endpoints.update(
          { id: next.id },
          { projectId: next.projectId, method: next.method, path: next.path, data: next },
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError(`${method} ${endpointPath} is already registered in this project`, 409);
        }
        throw error;
      }
      return next;
    });
  }

  async deleteEndpoint(id: string): Promise<void> {
    await withLock(ENDPOINTS_LOCK, async () => {
      const recordId = validId(str(id).trim());
      const current = recordId ? await this.getEndpoint(recordId) : null;
      if (!recordId || !current) throw new StoreError("Endpoint not found", 404);
      await this.endpoints.delete({ id: recordId });
    });
  }

  /* ------------------------------------------------------------------ *
   * Duplication - every nested row gets a fresh id
   * ------------------------------------------------------------------ */

  private cloneRule(rule: ValidationRule): ValidationRule {
    return {
      ...rule,
      id: newId("r"),
      value: Array.isArray(rule.value) ? [...rule.value] : rule.value,
    };
  }

  private cloneField(field: FieldDef): FieldDef {
    return {
      ...field,
      id: newId("f"),
      example: cloneJson(field.example),
      defaultValue: cloneJson(field.defaultValue),
      rules: asArray<ValidationRule>(field.rules).map((rule) => this.cloneRule(rule)),
      children: asArray<FieldDef>(field.children).map((child) => this.cloneField(child)),
    };
  }

  private cloneRequestSpec(spec: RequestSpec): RequestSpec {
    return {
      ...spec,
      body: asArray<FieldDef>(spec.body).map((field) => this.cloneField(field)),
      query: asArray<FieldDef>(spec.query).map((field) => this.cloneField(field)),
      headers: asArray<FieldDef>(spec.headers).map((field) => this.cloneField(field)),
    };
  }

  private cloneCondition(condition: Condition): Condition {
    return {
      ...condition,
      id: newId("c"),
      value: Array.isArray(condition.value) ? [...condition.value] : condition.value,
    };
  }

  private cloneScenario(scenario: ResponseScenario): ResponseScenario {
    return {
      ...scenario,
      id: newId("s"),
      conditions: asArray<Condition>(scenario.conditions).map((condition) => this.cloneCondition(condition)),
      headers: { ...scenario.headers },
      body: cloneJson(scenario.body),
    };
  }

  private cloneErrorTemplate(template: ErrorTemplate): ErrorTemplate {
    return { status: template.status, headers: { ...template.headers }, body: cloneJson(template.body) };
  }

  async duplicateEndpoint(id: string): Promise<EndpointDef> {
    return withLock(ENDPOINTS_LOCK, async () => {
      const recordId = validId(str(id).trim());
      const source = recordId ? await this.getEndpoint(recordId) : null;
      if (!recordId || !source) throw new StoreError("Endpoint not found", 404);

      const existing = await this.readAllEndpoints();
      const taken = new Set(
        existing
          .filter((endpoint) => endpoint.projectId === source.projectId && endpoint.method === source.method)
          .map((endpoint) => endpoint.path),
      );

      let copyPath = normalizePath(`${source.path}-copy`);
      for (let suffix = 2; taken.has(copyPath); suffix++) {
        copyPath = normalizePath(`${source.path}-copy-${suffix}`);
      }

      const copyId = newId("ep");
      const now = new Date().toISOString();
      const copy: EndpointDef = {
        ...source,
        id: copyId,
        name: `${source.name} (copy)`,
        path: copyPath,
        auth: { ...source.auth },
        request: this.cloneRequestSpec(source.request),
        scenarios: asArray<ResponseScenario>(source.scenarios).map((scenario) => this.cloneScenario(scenario)),
        validationError: this.cloneErrorTemplate(source.validationError),
        authError: this.cloneErrorTemplate(source.authError),
        tags: [...source.tags],
        createdAt: now,
        updatedAt: now,
      };

      try {
        await this.endpoints.insert({
          id: copy.id,
          projectId: copy.projectId,
          method: copy.method,
          path: copy.path,
          data: copy,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError("Could not allocate a unique path for the copy", 409);
        }
        throw error;
      }
      return copy;
    });
  }
}
