import z from "zod";

export const guestSpecsSchema = z.object({
  cpu_kind: z.enum(["shared", "performance"]),
  cpus: z.number().gte(1).lte(8),
  // between 512MB and 4GB
  memory_mb: z
    .number()
    .gte(512)
    .lte(8 * 1024),
});

export type GuestSpecs = z.infer<typeof guestSpecsSchema>;

export const serverSpecsSchema = z.object({
  guest: guestSpecsSchema,
  idleTimeout: z.number().gte(0),
});

export type ServerSpecs = z.infer<typeof serverSpecsSchema>;

export const joinReqBodySchema = z.object({
  gameId: z.string().nonempty(),
  userId: z.string().nonempty(),
  username: z.string().optional(),
  draft: z.boolean().optional(),
  specs: z.boolean().optional(),
});

export type JoinReqBody = z.infer<typeof joinReqBodySchema>;
