import type { Context } from "@deepseek-ai/cordis";

/** Host plugin half: balance + today-consumption routes, meter, and log replay. */
export const name: string;
export const inject: readonly string[];
export function apply(ctx: Context): void;
