import mongoose, { Schema } from 'mongoose';
import { config } from './config';

// Inmates (existing collection) with flexible schema
const InmateSchema = new Schema(
  {
    spn: { type: String, index: true },
    subject_id: { type: String, index: true },
    subjectId: { type: String, index: true },
    first_name: String,
    middle_name: String,
    last_name: String,
    age: Number,
    dob: Schema.Types.Mixed,
    city: String,
    state: String,
    county: { type: String, index: true },
    enrichment_flag: { type: Boolean, default: false, index: true },
    enrichment_status: { type: String, enum: ['NEW', 'READY', 'RUNNING', 'PARTIAL', 'FAILED', 'SUCCEEDED', 'CANCELLED'], default: 'NEW', index: true },
    enrichment_last_run_at: { type: Date, index: true },
    scraped_at: Date,
    _ingested_at: Date,
    fetched_at: Date,
    migrated_at: Date,
    first_seen_at: Date,
    inserted_at: Date,
    detail_fetched_at: Date,
    facts: { phones: [String], addresses: [String], emails: [String], usernames: [String], user_ids: [String] },
  hcso_status: new Schema({ notInJail: Boolean, asOf: String, message: String, source: String, notBondable: Boolean, bondExceptionText: String, moreChargesPossible: Boolean }, { _id: false }),
  },
  { strict: false, timestamps: true }
);
export const InmateModel = mongoose.models[config.subjectsCollection] || mongoose.model(config.subjectsCollection, InmateSchema, config.subjectsCollection);

// Enrichment jobs
const StepSchema = new Schema(
  { name: String, status: { type: String, enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'UNRESOLVED'], default: 'PENDING' }, startedAt: Date, finishedAt: Date, info: Schema.Types.Mixed },
  { _id: false }
);
const EnrichmentJobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    subjectId: { type: String, required: true, index: true },
    status: { type: String, enum: ['NEW', 'READY', 'RUNNING', 'PARTIAL', 'FAILED', 'SUCCEEDED', 'CANCELLED'], default: 'NEW', index: true },
    steps: [StepSchema],
    progress: { type: Number, default: 0 },
    logs: [String],
    errors: [String],
    idempotencyKey: { type: String, index: true },
  },
  { timestamps: true }
);
export const EnrichmentJobModel = mongoose.models.enrichment_jobs || mongoose.model('enrichment_jobs', EnrichmentJobSchema, 'enrichment_jobs');

// Related parties
const MatchAuditSchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    step: { type: String, default: 'pipl_party_pull' },
    provider: { type: String, default: 'pipl' },
    personsCount: Number,
    match: Number,
    accepted: Boolean,
    acceptance: { type: String, enum: ['SCORE', 'UNIQUE', 'REJECT'], default: 'REJECT' },
    matchMin: Number,
    requireUnique: Boolean,
    lastNameAgrees: Boolean,
    queriedName: String,
    city: String,
    state: String,
    // Value gate fields: record whether this run added new data
    gainedData: { type: Boolean },
    netNewPhones: { type: Number },
    netNewEmails: { type: Number },
    netNewAddresses: { type: Number },
  },
  { _id: false }
);
const RelatedPartySchema = new Schema(
  {
    subjectId: { type: String, index: true },
    partyId: { type: String, index: true },
    name: String,
    relationType: { type: String, enum: ['family', 'household', 'associate', 'unknown'], default: 'unknown' },
    // Optional human-readable relation label from the provider (e.g., "spouse", "brother")
    relationLabel: { type: String },
    confidence: Number,
    evidence: [new Schema({ type: String, value: String, weight: Number, provider: String }, { _id: false })],
    contacts: new Schema({ phones: [String], emails: [String] }, { _id: false }),
    addresses: [String],
    sources: [String],
    audits: [MatchAuditSchema],
  },
  { timestamps: true }
);
export const RelatedPartyModel = mongoose.models.related_parties || mongoose.model('related_parties', RelatedPartySchema, 'related_parties');

// Raw provider payloads
const RawPayloadSchema = new Schema(
  {
    jobId: { type: String, index: true },
    subjectId: { type: String, index: true },
    provider: { type: String, index: true },
    step: { type: String, index: true },
    payload: Schema.Types.Mixed,
    ttlExpiresAt: { type: Date },
  },
  { timestamps: true }
);
RawPayloadSchema.index({ ttlExpiresAt: 1 }, { expireAfterSeconds: 0 });
export const RawProviderPayloadModel = mongoose.models.raw_provider_payloads || mongoose.model('raw_provider_payloads', RawPayloadSchema, 'raw_provider_payloads');
