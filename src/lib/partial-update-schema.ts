import { z } from "zod";

/**
 * Makes every field of an object schema optional for PATCH-style updates. Unlike `.partial()`,
 * it drops each field's `.default(...)`: in zod 4 a defaulted field stays defaulted under
 * `.partial()`, so an omitted field would be filled in and silently overwrite stored data.
 * Object config (`.strict()`, catchall) is kept. The schema must not carry refinements.
 */
type PartialUpdateShape<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: z.ZodOptional<Shape[Key] extends z.ZodDefault<infer Inner> ? Inner : Shape[Key]>;
};

export function partialUpdateSchema<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [
    key,
    z.optional(field instanceof z.ZodDefault ? field.removeDefault() : field),
  ])) as PartialUpdateShape<Shape>;
  return schema.extend(shape);
}
