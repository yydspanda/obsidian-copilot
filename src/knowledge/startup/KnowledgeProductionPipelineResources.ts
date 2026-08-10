import { DEFAULT_KNOWLEDGE_COMPILER_LIMITS } from "@/knowledge/compiler/CompilerModelPort";
import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import { KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { ProjectKnowledgePipelineProfileSourceOptions } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import {
  MAX_KNOWLEDGE_PARSED_PDF_PAGES,
  type KnowledgeByteParser,
} from "@/knowledge/parser/KnowledgeByteParser";
import { PdfPageKnowledgeByteParser } from "@/knowledge/parser/PdfPageKnowledgeByteParser";
import { Utf8TextKnowledgeByteParser } from "@/knowledge/parser/Utf8TextKnowledgeByteParser";

/** Exact production compiler behavior version included in every pipeline fingerprint. */
export const KNOWLEDGE_PRODUCTION_COMPILER_VERSION = "knowledge-compiler-v2" as const;

/** Current bounded UTF-8 source policy for the first Windows production generation. */
export const KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS = Object.freeze({
  maxBytes: 8_388_608,
  maxCharacters: 8_000_000,
});

/** Current bounded PDF source policy for the Windows production generation. */
export const KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS = Object.freeze({
  maxBytes: 8_388_608,
  maxPages: MAX_KNOWLEDGE_PARSED_PDF_PAGES,
  maxCharacters: 8_000_000,
});

/** Owned parser capabilities and their matching secret-free profile projection. */
export interface KnowledgeProductionPipelineResources {
  parsers: readonly KnowledgeByteParser[];
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

/**
 * Creates one reviewed production parser registry and its exact profile options.
 *
 * The same factory is intended for startup preflight and the future worker so a
 * parser or compiler behavior change necessarily changes the pipeline identity.
 * No setting, credential, Vault service, or network capability enters this value.
 */
export function createKnowledgeProductionPipelineResources(): KnowledgeProductionPipelineResources {
  const textParser = new Utf8TextKnowledgeByteParser({
    id: "knowledge-utf8-text",
    pathSuffixes: [".md", ".markdown", ".txt"],
    maxBytes: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxBytes,
    maxCharacters: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxCharacters,
  });
  const pdfParser = new PdfPageKnowledgeByteParser({
    id: "knowledge-pdf-pages",
    pathSuffixes: [".pdf"],
    maxBytes: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxBytes,
    maxPages: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxPages,
    maxCharacters: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxCharacters,
  });
  const parsers: readonly KnowledgeByteParser[] = Object.freeze([textParser, pdfParser]);
  const compilerLimits = Object.freeze({ ...DEFAULT_KNOWLEDGE_COMPILER_LIMITS });
  const profileOptions: ProjectKnowledgePipelineProfileSourceOptions = Object.freeze({
    compilerVersion: KNOWLEDGE_PRODUCTION_COMPILER_VERSION,
    compilerConfiguration: Object.freeze({
      protocolVersion: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
      limits: compilerLimits,
    }),
    parsers: Object.freeze(parsers.map((parser) => parser.getProfile())),
    outputLanguage: "source-language",
    supportedProviders: Object.freeze(["deepseek"]),
    promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
    providerRouteIdentities: Object.freeze({
      deepseek: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY,
    }),
  });
  return Object.freeze({ parsers, profileOptions });
}
