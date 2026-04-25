import mongoose, { Schema } from 'mongoose';

const StepSchema = new Schema(
  {
    name: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'], default: 'PENDING' },
    startedAt: Date,
    finishedAt: Date,
    info: Schema.Types.Mixed,
  },
  { _id: false }
);

const EnrichmentJobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    subjectId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['NEW', 'READY', 'RUNNING', 'PARTIAL', 'FAILED', 'SUCCEEDED', 'CANCELLED'],
      default: 'NEW',
      index: true,
    },
    steps: [StepSchema],
    progress: { type: Number, default: 0 },
    logs: [String],
    errors: [String],
    idempotencyKey: { type: String, index: true },
  },
  { timestamps: true }
);

export const EnrichmentJobModel = mongoose.models.enrichment_jobs || mongoose.model('enrichment_jobs', EnrichmentJobSchema, 'enrichment_jobs');
