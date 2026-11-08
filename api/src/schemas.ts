import { z } from "zod";

/** The columns every source must deliver. Anything else counts as schema drift. */
export const EXPECTED_COLUMNS = ["external_id", "customer_email", "amount", "currency", "status", "updated_at"] as const;
export const REQUIRED_FIELDS = EXPECTED_COLUMNS;

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be a date").transform((s) => new Date(s).toISOString());

/** One order row, as we accept it. Rows that fail this go to the dead-letter table. */
export const OrderIn = z.object({
  external_id: z.string().trim().min(1, "required"),
  customer_email: z.email(),
  amount: z.coerce.number().finite().nonnegative(),
  currency: z.string().trim().length(3, "must be 3 letters"),
  status: z.string().trim().min(1, "required"),
  updated_at: isoDate,
});
export type OrderRow = z.infer<typeof OrderIn>;

export const SourceType = z.enum(["csv", "rest", "webhook"]);
export const Role = z.enum(["viewer", "engineer", "admin"]);
export type Role = z.infer<typeof Role>;

export const CreateSource = z.object({
  name: z.string().trim().min(2).max(60),
  type: SourceType,
  config: z.object({ baseUrl: z.url().optional(), apiKey: z.string().optional() }).default({}),
}).refine((s) => s.type !== "rest" || !!s.config.baseUrl, { message: "rest sources need config.baseUrl", path: ["config", "baseUrl"] });

export const ReplayBody = z.object({ payload: z.record(z.string(), z.unknown()).optional() });

export function issuesOf(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`);
}
