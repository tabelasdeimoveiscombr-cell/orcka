import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";

export async function runKeepalive(): Promise<void> {
  const { error } = await supabase
    .from("construtoras")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (error) throw new Error(error.message);
  logger.info("Consulta keepalive do Supabase concluída.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runKeepalive().catch((error: unknown) => {
    logger.error({ err: error }, "Falha no keepalive do Supabase");
    process.exitCode = 1;
  });
}
