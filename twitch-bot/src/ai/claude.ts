import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type * as z from "zod/v4";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Accès à Claude.
 * - `classify` : réponse JSON validée par un schéma Zod (modération, décision de clip).
 * - `converse` : discussion libre avec outils (planning, rediffs, clips…), la boucle d'appels
 *   d'outils est gérée par le tool runner du SDK.
 *
 * Les requêtes activent le repli serveur ("fallbacks: default") : si le modèle principal
 * refuse une requête pour raison de sécurité, l'API la rejoue automatiquement sur un autre modèle.
 */

// Lit ANTHROPIC_API_KEY (ou un profil `ant auth login`) depuis l'environnement.
export const anthropic = new Anthropic();

const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

export async function classify<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
}): Promise<z.infer<S> | null> {
  try {
    const response = await anthropic.beta.messages.parse({
      model: config.ai.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: config.ai.effort, format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (response.stop_reason === "refusal") {
      log.warn("Claude a refusé la requête de classification.");
      return null;
    }
    return (response.parsed_output as z.infer<S> | null) ?? null;
  } catch (err) {
    logApiError("classify", err);
    return null;
  }
}

export async function converse(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: BetaRunnableTool<any>[];
}): Promise<string | null> {
  try {
    const final = await anthropic.beta.messages.toolRunner({
      model: config.ai.model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: config.ai.effort },
      max_iterations: 5,
      // Le prompt système est stable : on le met en cache.
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: opts.tools,
      messages: opts.messages,
    });
    if (final.stop_reason === "refusal") return null;
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || null;
  } catch (err) {
    logApiError("converse", err);
    return null;
  }
}

function logApiError(where: string, err: unknown): void {
  if (err instanceof Anthropic.RateLimitError) log.warn(`[${where}] Limite de débit Claude atteinte, on réessaiera plus tard.`);
  else if (err instanceof Anthropic.AuthenticationError) log.error(`[${where}] Clé ANTHROPIC_API_KEY invalide.`);
  else if (err instanceof Anthropic.APIError) log.error(`[${where}] Erreur API Claude ${err.status} : ${err.message}`);
  else log.error(`[${where}]`, err);
}
