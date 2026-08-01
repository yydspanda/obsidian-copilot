import type { KnowledgeCompilerInfrastructureFailureCode } from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompilerInfrastructureError } from "@/knowledge/compiler/KnowledgeCompiler";
import { IngestExecutorError } from "@/knowledge/ingest/queue/IngestQueue";

interface QueueFailureProjection {
  code: string;
  message: string;
  retryable: boolean;
  rateLimited: boolean;
}

const QUEUE_FAILURES: Readonly<
  Record<KnowledgeCompilerInfrastructureFailureCode, QueueFailureProjection>
> = Object.freeze({
  dependency_failed: Object.freeze({
    code: "knowledge_compiler_dependency_failed",
    message: "A knowledge compiler dependency is temporarily unavailable",
    retryable: true,
    rateLimited: false,
  }),
  model_authority_failed: Object.freeze({
    code: "knowledge_model_authority_failed",
    message: "The knowledge model execution authority is no longer valid",
    retryable: false,
    rateLimited: false,
  }),
  model_output_invalid: Object.freeze({
    code: "knowledge_model_response_invalid",
    message: "The knowledge model returned an invalid structured response",
    retryable: false,
    rateLimited: false,
  }),
  provider_request_rejected: Object.freeze({
    code: "knowledge_model_request_rejected",
    message: "The knowledge model provider rejected the request",
    retryable: false,
    rateLimited: false,
  }),
  provider_unauthorized: Object.freeze({
    code: "knowledge_provider_unauthorized",
    message: "The knowledge model credential was rejected",
    retryable: false,
    rateLimited: false,
  }),
  provider_balance_required: Object.freeze({
    code: "knowledge_provider_balance_required",
    message: "The knowledge model provider account requires balance",
    retryable: false,
    rateLimited: false,
  }),
  provider_rate_limited: Object.freeze({
    code: "knowledge_provider_rate_limited",
    message: "The knowledge model provider rate limit was reached",
    retryable: true,
    rateLimited: true,
  }),
  provider_unavailable: Object.freeze({
    code: "knowledge_provider_unavailable",
    message: "The knowledge model provider is temporarily unavailable",
    retryable: true,
    rateLimited: false,
  }),
  provider_network_failed: Object.freeze({
    code: "knowledge_provider_network_failed",
    message: "The knowledge model provider could not be reached",
    retryable: true,
    rateLimited: false,
  }),
  provider_http_failed: Object.freeze({
    code: "knowledge_provider_http_failed",
    message: "The knowledge model provider returned an unsupported HTTP failure",
    retryable: false,
    rateLimited: false,
  }),
  provider_response_invalid: Object.freeze({
    code: "knowledge_provider_response_invalid",
    message: "The knowledge model provider returned an invalid response",
    retryable: false,
    rateLimited: false,
  }),
});

/**
 * Translates one sanitized Compiler infrastructure failure into Queue-owned facts.
 *
 * Provider errors never choose a delay or retry count. They only supply the
 * stable booleans consumed by the Queue's existing RetryPolicy.
 *
 * @param error - Opaque Compiler rejection
 * @param signal - Exact Queue-owned signal for the current execution attempt
 * @returns Fresh Queue error, or undefined for cancellation/unrelated failures
 */
export function createKnowledgeCompilerIngestExecutorError(
  error: unknown,
  signal: AbortSignal
): IngestExecutorError | undefined {
  if (signal.aborted) return undefined;
  const state = KnowledgeCompilerInfrastructureError.inspect(error);
  if (!state || !KnowledgeCompilerInfrastructureError.matchesSignal(error, signal))
    return undefined;
  const projection = QUEUE_FAILURES[state.code];
  if (!projection) return undefined;
  return new IngestExecutorError(
    {
      code: projection.code,
      message: projection.message,
      retryable: projection.retryable,
      rateLimited: projection.rateLimited,
    },
    signal
  );
}
