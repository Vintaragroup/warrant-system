import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const JobSchema = new Schema(
  {
    // Identifiers / scoping
    name: { type: String, index: true },            // e.g., "normalize:harris" or "scrape:jefferson"
    kind: { type: String, index: true },            // e.g., "normalize" | "scrape" | "audit"
    county: { type: String, index: true, lowercase: true, trim: true },
    source: { type: String, index: true },          // e.g., source collection name

    // Lifecycle
    status: {
      type: String,
      enum: ['queued', 'running', 'success', 'failed'],
      index: true,
      default: 'queued',
    },
    queuedAt:   { type: Date, default: Date.now, index: true },
    startedAt:  { type: Date, index: true },
    finishedAt: { type: Date, index: true },

    // Attempts + result metrics
    attempts: { type: Number, default: 0, min: 0 },
    counts: {
      seen: { type: Number, default: 0, min: 0 },
      inserted: { type: Number, default: 0, min: 0 },
      updated: { type: Number, default: 0, min: 0 },
      skipped: { type: Number, default: 0, min: 0 },
      errors: { type: Number, default: 0, min: 0 },
    },                    // e.g., { seen, inserted, updated, skipped, errors }

    // Error info
    error: String,
    errorCode: String,
  },
  { timestamps: true }
);

// Useful derived metric (ms) — null until started
JobSchema.virtual('durationMs').get(function () {
  const start = this.startedAt || this.createdAt;
  const end = this.finishedAt || Date.now();
  return start ? (new Date(end) - new Date(start)) : null;
});

// Helper method to check if job is active
JobSchema.methods.isActive = function () {
  return this.status === 'queued' || this.status === 'running';
};

// Indexes that help list/monitor jobs efficiently
JobSchema.index({ status: 1, queuedAt: 1 });
JobSchema.index({ kind: 1, status: 1, createdAt: -1 });
JobSchema.index({ county: 1, createdAt: -1 });
JobSchema.index({ finishedAt: -1 });
JobSchema.index({ county: 1, kind: 1, createdAt: -1 });

// Normalize JSON output: include `id`, remove `_id`/`__v`, keep virtuals
JobSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});
JobSchema.set('toObject', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

const Job = model('Job', JobSchema);

export { JobSchema };
export default Job;