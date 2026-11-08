import { z } from "zod";
export const publicUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((s, ctx) => {
    try {
      const u = new URL(s);
      // A trailing dot names the same host ("localhost." is localhost).
      const host = u.hostname.toLowerCase().replace(/\.+$/, "");
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        (u.port && !["80", "443"].includes(u.port)) ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        !host.includes(".") ||
        host.includes(":") ||
        /^\d+(\.\d+){3}$/.test(host)
      )
        throw Error();
      u.hash = "";
      return u.href;
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "Use a public HTTP or HTTPS domain, without credentials or a custom port.",
      });
      return z.NEVER;
    }
  });
export const createRunSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    description: z.string().trim().max(4000).default(""),
    urls: z.array(publicUrl).min(1).max(25),
    mode: z.enum(["pages", "crawl"]).default("pages"),
    fetch_mode: z.enum(["http", "browser"]).default("http"),
    folder_id: z.uuid().nullable().default(null),
  })
  .transform((v) => ({ ...v, urls: [...new Set(v.urls)] }))
  .refine((v) => v.mode !== "crawl" || v.urls.length === 1, {
    message: "A crawl needs exactly one starting URL.",
  });
export const pageSchema = z.object({
  id: z.uuid(),
  url: publicUrl,
  final_url: publicUrl.nullable().default(null),
  parent_url: publicUrl.nullable().default(null),
  title: z.string().max(500).default(""),
  status: z.enum(["success", "failed", "blocked", "unsupported", "limit"]),
  error: z.string().max(2000).nullable().default(null),
  markdown: z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, "utf8") <= 500000,
      "Page exceeds 500 KB",
    ),
  collected_at: z.iso.datetime({ offset: true }),
});
export const folderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the folder a name.")
    .max(120, "Use a folder name under 120 characters."),
  parent_id: z.uuid().nullable().default(null),
});
export const folderUpdateSchema = z
  .object({
    name: folderSchema.shape.name.optional(),
    parent_id: z.uuid().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.parent_id !== undefined, {
    message: "Nothing to change.",
  });
export const folderMoveSchema = z
  .object({
    parent_id: z.uuid().nullable(),
    before_id: z.uuid().nullable().optional(),
    after_id: z.uuid().nullable().optional(),
  })
  .refine((v) => !(v.before_id && v.after_id), {
    message: "Use before or after, not both.",
  });
export const runIdsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});
export const moveRunsSchema = runIdsSchema.extend({
  folder_id: z.uuid().nullable(),
});
export const leaseSchema = z.object({
  run_id: z.uuid(),
  lease_token: z.uuid(),
});
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
