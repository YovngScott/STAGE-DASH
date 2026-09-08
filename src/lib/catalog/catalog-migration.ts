import { z } from "zod";

export const catalogRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  tipo_pieza: z.string().trim().min(1).max(200),
  dispositivo: z.string().trim().min(1).max(200),
  calidad: z.enum(["original", "oem", "generica", "usada"]),
  precio: z.coerce.number().finite().nonnegative(),
  moneda: z.string().regex(/^[A-Z]{3}$/),
  stock: z.coerce.number().int().nonnegative().max(2_147_483_647),
  garantia_dias: z.coerce.number().int().nonnegative().nullable().optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  disponible: z.boolean().default(true),
});

export function toServicio(input: unknown) {
  const row = catalogRowSchema.parse(input);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    nombre: `${row.tipo_pieza} ${row.dispositivo} (${row.calidad})`,
    categoria: row.tipo_pieza,
    precio: row.precio,
    moneda: row.moneda,
    stock: row.stock,
    garantia_dias: row.garantia_dias ?? null,
    descripcion: row.descripcion ?? null,
    disponible: row.disponible,
    actualizado_en: new Date().toISOString(),
  };
}
