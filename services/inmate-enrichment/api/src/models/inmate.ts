import mongoose, { Schema } from 'mongoose';

const InmateSchema = new Schema(
  {
    // flexible schema: allow unknown fields, but index a few
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
    enrichment_status: {
      type: String,
      enum: ['NEW', 'READY', 'RUNNING', 'PARTIAL', 'FAILED', 'SUCCEEDED', 'CANCELLED'],
      default: 'NEW',
      index: true,
    },
    enrichment_last_run_at: { type: Date, index: true },
    // candidate timestamps for filtering window
    scraped_at: Date,
    _ingested_at: Date,
    fetched_at: Date,
    migrated_at: Date,
    first_seen_at: Date,
    inserted_at: Date,
    detail_fetched_at: Date,
    facts: {
      phones: [String],
      addresses: [String],
      emails: [String],
      usernames: [String],
      user_ids: [String],
    },
  },
  { strict: false, timestamps: true }
);

export const InmateModel = mongoose.models.inmates || mongoose.model('inmates', InmateSchema, 'inmates');
