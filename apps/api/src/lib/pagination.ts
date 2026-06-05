import { z } from "zod";

/**
 * Paginación server-side uniforme para los listados. `limit` por defecto 10,
 * tope 100 (los tamaños ofrecidos en la UI son 10/20/50/100). Coerciona desde
 * el query string.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;
