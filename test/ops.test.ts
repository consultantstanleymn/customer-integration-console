// Checks the ops files without needing Docker, kubectl or a cluster: parse them and test the rules we care about.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";
import { createMetrics } from "../api/src/metrics.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const docs = (p: string) => parseAllDocuments(read(p)).map((d) => d.toJS() as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
const k8s = ["api.yaml", "web.yaml", "configmap.yaml", "ingress.yaml", "namespace.yaml"].flatMap((f) => docs(`k8s/${f}`));
const kind = (k: string) => k8s.filter((d) => d.kind === k);

describe("kubernetes manifests", () => {
  it("every object has apiVersion, kind and name", () => {
    for (const d of k8s) { expect(d.apiVersion).toBeTruthy(); expect(d.kind).toBeTruthy(); expect(d.metadata.name).toBeTruthy(); }
  });
  it("deployments have probes, limits and a non-root, locked-down container", () => {
    for (const d of kind("Deployment")) {
      const pod = d.spec.template.spec;
      expect(pod.securityContext.runAsNonRoot).toBe(true);
      const c = pod.containers[0];
      expect(c.readinessProbe).toBeDefined();
      expect(c.livenessProbe).toBeDefined();
      expect(c.resources.limits.memory).toBeDefined();
      expect(c.securityContext.allowPrivilegeEscalation).toBe(false);
      expect(c.securityContext.readOnlyRootFilesystem).toBe(true);
    }
  });
  it("service selectors match deployment labels", () => {
    for (const s of kind("Service")) {
      const dep = kind("Deployment").find((d) => d.metadata.name === s.metadata.name)!;
      expect(dep.spec.template.metadata.labels).toMatchObject(s.spec.selector);
    }
  });
  it("each HPA points at an existing deployment", () => {
    const names = kind("Deployment").map((d) => d.metadata.name);
    const hpas = kind("HorizontalPodAutoscaler");
    expect(hpas.length).toBe(2);
    for (const h of hpas) expect(names).toContain(h.spec.scaleTargetRef.name);
  });
  it("ingress backends exist and only the web is public", () => {
    const backends = kind("Ingress")[0]!.spec.rules[0].http.paths.map((p: any) => p.backend.service.name); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(backends).toEqual(["web"]);
  });
  it("secret template holds placeholders only, and is not in the kustomization", () => {
    const secret = docs("k8s/secret.template.yaml")[0]!;
    expect(secret.stringData.OIDC_CLIENT_SECRET).toBe("CHANGE_ME");
    expect(read("k8s/kustomization.yaml")).not.toMatch(/^resources:.*secret/m);
  });
  it("deployments read secrets from the secret, not from plain config", () => {
    const refs = kind("Deployment").find((d) => d.metadata.name === "api")!.spec.template.spec.containers[0].envFrom;
    expect(refs.some((r: any) => r.secretRef?.name === "console-secrets")).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(docs("k8s/configmap.yaml"))).not.toMatch(/SECRET|PASSWORD/);
  });
});

describe("docker compose", () => {
  const c = parse(read("docker-compose.yml")) as { services: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  it("has the five required services plus an observability profile", () => {
    for (const s of ["web", "api", "postgres", "mock-oidc", "mock-source"]) expect(c.services[s]).toBeDefined();
    expect(c.services.prometheus.profiles).toContain("observability");
    expect(c.services.grafana.profiles).toContain("observability");
  });
  it("depends_on only names real services", () => {
    for (const s of Object.values(c.services)) {
      const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on ?? {});
      for (const d of deps) expect(c.services[d]).toBeDefined();
    }
  });
  it("has no hard-coded passwords: every secret has an env default marker", () => {
    expect(read("docker-compose.yml")).toMatch(/\$\{POSTGRES_PASSWORD:-/);
    expect(read(".env.example")).toContain("change-me");
  });
});

describe("observability", () => {
  it("every metric the Grafana dashboard queries is exported by the API", async () => {
    const dash = JSON.parse(read("observability/grafana/dashboards/overview.json"));
    const exprs: string[] = dash.panels.flatMap((p: any) => p.targets.map((t: any) => t.expr)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const exported = await createMetrics().registry.getMetricsAsJSON();
    const names = new Set(exported.map((m) => m.name));
    for (const m of ["pipeline_runs_total", "pipeline_rows_total", "dead_letters_pending", "http_request_duration_seconds", "pipeline_run_duration_seconds", "auth_events_total"]) {
      expect(names.has(m)).toBe(true);
      expect(exprs.join(" ")).toContain(m);
    }
  });
  it("prometheus scrapes the api metrics path", () => {
    const p = parse(read("observability/prometheus.yml"));
    expect(p.scrape_configs[0].metrics_path).toBe("/metrics");
  });
});
