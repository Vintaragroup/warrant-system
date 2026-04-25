/\*\*

- Base Analyzer Interface
-
- All analyzers must implement this interface to ensure:
- - Versioning for reproducibility
- - Input validation
- - Deterministic execution (same input → same output)
- - Idempotency via input hashing
    \*/

import { createHash } from "crypto";

// ============================================================================
// Base Interfaces
// ============================================================================

export interface ValidationResult {
valid: boolean;
errors: string[];
warnings: string[];
}

export interface AnalyzerMetadata {
name: string;
version: string; // Semver (e.g., "1.0.0")
released_at: string;
breaking_changes_from?: string; // Previous version with breaking changes
changelog: string;
}

export interface Analyzer<TInput, TOutput> {
// Metadata
readonly metadata: AnalyzerMetadata;

/\*\*

- Core analysis method
-
- MUST be deterministic: same input → same output
- MUST NOT have side effects
- MUST NOT call LLM directly (use heuristics only)
  \*/
  analyze(input: TInput): Promise<TOutput>;

/\*\*

- Validate input before analysis
-
- Checks:
- - Required fields present
- - Value ranges correct
- - Data types valid
    \*/
    validateInput(input: TInput): ValidationResult;

/\*\*

- Generate hash of input for caching/idempotency
-
- Used to detect if analysis has already been run on this exact input.
- MUST produce same hash for semantically identical inputs.
  \*/
  getInputHash(input: TInput): string;
  }

// ============================================================================
// Base Analyzer Class
// ============================================================================

export abstract class BaseAnalyzer<TInput, TOutput> implements Analyzer<TInput, TOutput> {
abstract readonly metadata: AnalyzerMetadata;

/\*\*

- Main analysis method - must be implemented by subclass
  \*/
  abstract analyze(input: TInput): Promise<TOutput>;

/\*\*

- Validate input - can be overridden for custom validation
  \*/
  validateInput(input: TInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];


    // Basic null check
    if (!input) {
      errors.push("Input is null or undefined");
      return { valid: false, errors, warnings };
    }

    // Subclasses should override for specific validation
    return { valid: true, errors, warnings };

}

/\*\*

- Generate deterministic hash of input
-
- Default implementation: JSON stringify + SHA-256
- Override if custom hashing needed
  \*/
  getInputHash(input: TInput): string {
  try {
  // Sort keys for deterministic JSON
  const canonical = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
  } catch (err) {
  throw new Error(`Failed to hash input: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
  }

/\*\*

- Helper: Execute analysis with validation
  \*/
  async analyzeWithValidation(input: TInput): Promise<TOutput> {
  // Validate input
  const validation = this.validateInput(input);
  if (!validation.valid) {
  throw new AnalyzerValidationError(
  `${this.metadata.name} input validation failed`,
  validation.errors,
  validation.warnings
  );
  }


    // Log warnings
    if (validation.warnings.length > 0) {
      console.warn(`[${this.metadata.name}] Validation warnings:`, validation.warnings);
    }

    // Execute analysis
    const start = Date.now();
    const result = await this.analyze(input);
    const duration = Date.now() - start;

    console.log(`[${this.metadata.name}] Analysis completed in ${duration}ms`);

    return result;

}
}

// ============================================================================
// Error Classes
// ============================================================================

export class AnalyzerValidationError extends Error {
constructor(
message: string,
public readonly errors: string[],
public readonly warnings: string[]
) {
super(message);
this.name = "AnalyzerValidationError";
}
}

export class AnalyzerExecutionError extends Error {
constructor(
message: string,
public readonly analyzerName: string,
public readonly analyzerVersion: string,
public readonly cause?: Error
) {
super(message);
this.name = "AnalyzerExecutionError";
}
}

// ============================================================================
// Analyzer Result Base
// ============================================================================

export interface AnalyzerResultBase {
analyzer_version: string;
executed_at: string; // ISO 8601
evidence_ids: string[]; // UUIDs of cited evidence
}

/\*\*

- Helper to create result metadata
  \*/
  export function createResultMetadata(
  analyzerVersion: string,
  evidenceIds: string[]
  ): Pick<AnalyzerResultBase, "analyzer_version" | "executed_at" | "evidence_ids"> {
  return {
  analyzer_version: analyzerVersion,
  executed_at: new Date().toISOString(),
  evidence_ids: evidenceIds,
  };
  }

// ============================================================================
// Analyzer Registry
// ============================================================================

export interface AnalyzerRegistry {
register<TInput, TOutput>(analyzer: Analyzer<TInput, TOutput>): void;
get<TInput, TOutput>(name: string, version?: string): Analyzer<TInput, TOutput> | null;
list(): AnalyzerMetadata[];
}

export class InMemoryAnalyzerRegistry implements AnalyzerRegistry {
private analyzers = new Map<string, Analyzer<any, any>>();

register<TInput, TOutput>(analyzer: Analyzer<TInput, TOutput>): void {
const key = `${analyzer.metadata.name}@${analyzer.metadata.version}`;

    if (this.analyzers.has(key)) {
      console.warn(`Analyzer ${key} already registered, overwriting`);
    }

    this.analyzers.set(key, analyzer);
    console.log(`Registered analyzer: ${key}`);

}

get<TInput, TOutput>(name: string, version?: string): Analyzer<TInput, TOutput> | null {
if (version) {
const key = `${name}@${version}`;
return this.analyzers.get(key) || null;
}

    // Get latest version if no version specified
    const matching = Array.from(this.analyzers.entries())
      .filter(([key]) => key.startsWith(`${name}@`))
      .sort(([a], [b]) => b.localeCompare(a)); // Reverse sort for latest

    return matching.length > 0 ? matching[0][1] : null;

}

list(): AnalyzerMetadata[] {
return Array.from(this.analyzers.values()).map((a) => a.metadata);
}
}

// ============================================================================
// Global Registry Instance
// ============================================================================

export const analyzerRegistry = new InMemoryAnalyzerRegistry();
