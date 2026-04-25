// Minimal OpenAPI 3.0 spec for the enrichment API
// Exposes core endpoints used by the Bail Bonds UI: prospects_window, dob_sweep, subject_summary

const servers = [{ url: "http://localhost:4000/api", description: "Local Enrichment API" }];

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Inmate Enrichment API",
    version: "1.0.0",
    description:
      "Production-focused enrichment endpoints powering Prospects, DOB sweeps, and Subject summaries.",
  },
  servers,
  tags: [
    { name: "Enrichment", description: "Prospects, coverage, subject summaries, and sweeps" },
    { name: "Providers", description: "Provider connectivity and first-pull endpoints" },
  ],
  paths: {
    "/enrichment/prospects_window": {
      get: {
        tags: ["Enrichment"],
        summary: "Prospects window",
        description:
          "Returns prospects within a booking window. Defaults exclude strict not-bondable. Use 'total' for KPI and 'rows' for the current page.",
        parameters: [
          { in: "query", name: "windowHours", schema: { type: "integer", minimum: 1, maximum: 168, default: 48 } },
          { in: "query", name: "minBond", schema: { type: "number", default: 500 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 0, maximum: 200, default: 0 } },
          { in: "query", name: "includeNotBondable", schema: { type: "boolean", default: false } },
        ],
        responses: {
          "200": {
            description: "Prospects response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProspectsWindowResponse" },
              },
            },
          },
        },
      },
    },
    "/enrichment/dob_sweep": {
      post: {
        tags: ["Enrichment"],
        summary: "Enqueue DOB-only sweep",
        description:
          "Enqueues DOB-only jobs for recent inmates based on booking window and bond threshold, excluding not-in-jail.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DobSweepRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Sweep enqueued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DobSweepResponse" } } },
          },
        },
      },
    },
    "/enrichment/subject_summary": {
      get: {
        tags: ["Enrichment"],
        summary: "Subject summary",
        parameters: [
          { in: "query", name: "subjectId", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Summary",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SubjectSummaryResponse" } } },
          },
          "404": { description: "Subject not found" },
        },
      },
    },
    "/enrichment/coverage24h": {
      get: {
        tags: ["Enrichment"],
        summary: "24h coverage (minBond filter)",
        parameters: [
          { in: "query", name: "minBond", schema: { type: "number", default: 1000 } },
        ],
        responses: {
          "200": { description: "Coverage", content: { "application/json": { schema: { $ref: "#/components/schemas/CoverageResponse" } } } },
        },
      },
    },
    "/enrichment/coverage72h": {
      get: {
        tags: ["Enrichment"],
        summary: "72h coverage (overall)",
        responses: {
          "200": { description: "Coverage", content: { "application/json": { schema: { $ref: "#/components/schemas/CoverageResponse" } } } },
        },
      },
    },
    "/enrichment/related_parties": {
      get: {
        tags: ["Enrichment"],
        summary: "List related parties for a subject",
        parameters: [
          { in: "query", name: "subjectId", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Related parties",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RelatedPartiesResponse" } } },
          },
        },
      },
    },
    "/enrichment/related_party_pull": {
      post: {
        tags: ["Enrichment"],
        summary: "Trigger related-party enrichment",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RelatedPartyPullRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/enrichment/related_party_audits": {
      get: {
        tags: ["Enrichment"],
        summary: "Related-party audit history",
        parameters: [
          { in: "query", name: "subjectId", required: true, schema: { type: "string" } },
          { in: "query", name: "partyId", required: false, schema: { type: "string" } },
          { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          "200": { description: "Audits", content: { "application/json": { schema: { $ref: "#/components/schemas/RelatedPartyAuditsResponse" } } } },
        },
      },
    },
    "/enrichment/related_party_validate_phones": {
      post: {
        tags: ["Enrichment"],
        summary: "Validate phones for related parties",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RelatedPartyValidatePhonesRequest" } } },
        },
        responses: {
          "200": { description: "Validation queued", content: { "application/json": { schema: { $ref: "#/components/schemas/OkResponse" } } } },
        },
      },
    },
    "/enrichment/pipl_matches": {
      get: {
        tags: ["Providers"],
        summary: "Normalized Pipl matches for a subject",
        parameters: [ { in: "query", name: "subjectId", required: true, schema: { type: "string" } } ],
        responses: {
          "200": { description: "Matches", content: { "application/json": { schema: { $ref: "#/components/schemas/PiplMatchesResponse" } } } },
        },
      },
    },
    "/providers/pipl/test": {
      get: { tags: ["Providers"], summary: "Pipl connectivity test", responses: { "200": { description: "OK" }, "400": { description: "Disabled or missing key" } } },
    },
    "/enrichment/pipl_first_pull": {
      post: {
        tags: ["Providers"],
        summary: "Run Pipl first pull for subject",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { subjectId: { type: "string" }, overrideLocation: { type: "boolean" } }, required: ["subjectId"] } } },
        },
        responses: { "200": { description: "Provider result" }, "400": { description: "Bad request" }, "404": { description: "Subject not found" } },
      },
    },
  },
  components: {
    schemas: {
      ProspectRow: {
        type: "object",
        properties: {
          subjectId: { type: "string" },
          bond: { type: ["number", "null"] },
          dob: { type: ["string", "null"] },
          bookingDate: { type: ["string", "null"], format: "date-time" },
          baseAddressSnippet: { type: ["string", "null"] },
          notBondable: { type: "boolean" },
          notBondableStrict: { type: "boolean" },
          moreChargesPossible: { type: "boolean" },
          bondExceptionText: { type: ["string", "null"] },
        },
        required: ["subjectId"],
      },
      ProspectsWindowResponse: {
        type: "object",
        properties: {
          windowHours: { type: "integer" },
          minBond: { type: "number" },
          includeNotBondable: { type: "boolean" },
          total: { type: "integer" },
          excludedStrictNotBondable: { type: "integer" },
          moreChargesPossibleCount: { type: "integer" },
          count: { type: "integer" },
          rows: { type: "array", items: { $ref: "#/components/schemas/ProspectRow" } },
        },
      },
      DobSweepRequest: {
        type: "object",
        properties: {
          windowHours: { type: "integer", minimum: 1, maximum: 168, default: 24 },
          minBond: { type: "number", default: 500 },
          limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
          suffix: { type: "string" },
        },
      },
      DobSweepResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          enqueued: { type: "integer" },
          requested: { type: "integer" },
          windowHours: { type: "integer" },
          minBond: { type: "number" },
          limit: { type: "integer" },
          suffix: { type: "string" },
          jobIdsSample: { type: "array", items: { type: "string" } },
        },
      },
      CoverageResponse: {
        type: "object",
        properties: {
          total: { type: "integer" },
          haveDob: { type: "integer" },
          notInJail: { type: "integer" },
          unresolved: { type: "integer" },
          pct: { type: "number" },
          minBond: { type: ["number", "null"] },
          notBondable: { type: ["integer", "null"] },
          moreCharges: { type: ["integer", "null"] },
        },
      },
      SubjectSummaryResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          summary: {
            type: "object",
            properties: {
              subjectId: { type: "string" },
              name: { type: ["string", "null"] },
              dob: { type: ["string", "null"] },
              bond: { type: ["number", "null"] },
              baseAddress: { type: ["string", "null"] },
              phones: { type: "array", items: { type: "string" } },
              flags: { type: "object", additionalProperties: true },
              enrichment_status: { type: ["string", "null"] },
              facts: { type: "object", additionalProperties: true },
              steps: { type: "array", items: { type: "object", properties: { name: { type: "string" }, status: { type: "string" }, info: { type: ["object", "null"] } } } },
              relatedParties: { type: "array", items: { type: "object", properties: { name: { type: "string" }, relationType: { type: "string" }, confidence: { type: "number" }, lastAudit: { type: ["object", "null"] } } } },
              piplPreview: { type: ["object", "null"], additionalProperties: true },
            },
          },
        },
      },
      Address: {
        type: "object",
        properties: {
          streetLine1: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          stateCode: { type: ["string", "null"] },
          postalCode: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
        },
      },
      Contact: {
        type: "object",
        properties: {
          value: { type: ["string", "null"] },
          lineType: { type: ["string", "null"] },
        },
      },
      LastAudit: {
        type: "object",
        properties: {
          at: { type: ["string", "null"], format: "date-time" },
          match: { type: ["number", "null"] },
          accepted: { type: ["boolean", "null"] },
          cooldownUntil: { type: ["string", "null"], format: "date-time" },
          targeted: { type: ["boolean", "null"] },
        },
      },
      RelatedParty: {
        type: "object",
        properties: {
          partyId: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          relationType: { type: ["string", "null"] },
          contacts: {
            type: "object",
            properties: {
              phones: { type: "array", items: { type: "string" } },
              emails: { type: "array", items: { type: "string" } },
            },
          },
          addresses: { type: "array", items: { $ref: "#/components/schemas/Address" } },
          lastAudit: { $ref: "#/components/schemas/LastAudit" },
        },
      },
      RelatedPartiesResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "integer" },
          rows: { type: "array", items: { $ref: "#/components/schemas/RelatedParty" } },
        },
      },
      RelatedPartyPullRequest: {
        type: "object",
        properties: {
          subjectId: { type: "string" },
          maxParties: { type: "integer" },
          requireUnique: { type: "boolean" },
          matchMin: { type: "number" },
          partyId: { type: "string" },
          partyName: { type: "string" },
          aggressive: { type: "boolean" },
        },
        required: ["subjectId"],
      },
      RelatedPartyAuditRow: {
        type: "object",
        properties: {
          at: { type: ["string", "null"], format: "date-time" },
          accepted: { type: ["boolean", "null"] },
          match: { type: ["number", "null"] },
          targeted: { type: ["boolean", "null"] },
          info: { type: ["object", "null"], additionalProperties: true },
        },
      },
      RelatedPartyAuditsResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "integer" },
          summary: {
            type: "object",
            properties: {
              accepted: { type: "integer" },
              rejected: { type: "integer" },
              acceptanceRate: { type: ["number", "null"] },
            },
          },
          rows: { type: "array", items: { $ref: "#/components/schemas/RelatedPartyAuditRow" } },
        },
      },
      RelatedPartyValidatePhonesRequest: {
        type: "object",
        properties: {
          subjectId: { type: "string" },
          maxPerParty: { type: "integer" },
        },
        required: ["subjectId"],
      },
      PiplMatchRow: {
        type: "object",
        properties: {
          recordId: { type: ["string", "null"] },
          fullName: { type: ["string", "null"] },
          match: { type: ["number", "null"] },
          ageRange: { type: ["string", "null"] },
          gender: { type: ["string", "null"] },
          contacts: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
          addresses: { type: "array", items: { $ref: "#/components/schemas/Address" } },
        },
      },
      PiplMatchesResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "integer" },
          rows: { type: "array", items: { $ref: "#/components/schemas/PiplMatchRow" } },
        },
      },
      OkResponse: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
    },
  },
} as const;

export default openapiSpec;
