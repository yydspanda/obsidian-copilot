import { DEFAULT_KNOWLEDGE_COMPILER_LIMITS } from "@/knowledge/compiler/CompilerModelPort";
import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import { KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { ProjectKnowledgePipelineProfileSourceOptions } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import {
  MAX_KNOWLEDGE_PARSED_PDF_PAGES,
  MAX_KNOWLEDGE_SOURCE_BYTES,
  type KnowledgeByteParser,
} from "@/knowledge/parser/KnowledgeByteParser";
import { PdfPageKnowledgeByteParser } from "@/knowledge/parser/PdfPageKnowledgeByteParser";
import { Utf8TextKnowledgeByteParser } from "@/knowledge/parser/Utf8TextKnowledgeByteParser";

// Full-source writing must not reuse a prior model-selected no-target outcome.
// https://github.com/yydspanda/obsidian-copilot/issues/20
export const KNOWLEDGE_PRODUCTION_COMPILER_VERSION = "knowledge-compiler-v4" as const;

export const KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS = Object.freeze({
  maxBytes: MAX_KNOWLEDGE_SOURCE_BYTES,
  maxCharacters: 8_000_000,
});

export const KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS = Object.freeze({
  maxBytes: MAX_KNOWLEDGE_SOURCE_BYTES,
  maxPages: MAX_KNOWLEDGE_PARSED_PDF_PAGES,
  maxCharacters: 8_000_000,
});

export interface KnowledgeProductionPipelineResources {
  parsers: readonly KnowledgeByteParser[];
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

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
