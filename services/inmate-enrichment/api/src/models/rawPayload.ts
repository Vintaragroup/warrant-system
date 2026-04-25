import mongoose, { Schema } from 'mongoose';

const RawPayloadSchema = new Schema(
  {
    jobId: { type: String, index: true },
    provider: { type: String, index: true },
    step: { type: String, index: true },
    payload: Schema.Types.Mixed,
    ttlExpiresAt: { type: Date, index: true },
  },
  { timestamps: true }
);

RawPayloadSchema.index({ ttlExpiresAt: 1 }, { expireAfterSeconds: 0 });

export const RawProviderPayloadModel = mongoose.models.raw_provider_payloads || mongoose.model('raw_provider_payloads', RawPayloadSchema, 'raw_provider_payloads');
