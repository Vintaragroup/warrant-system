import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const PingLocationSchema = new Schema(
  {
    lat: Number,
    lng: Number,
    accuracy: Number,
  },
  { _id: false }
);

const CheckInPingSchema = new Schema(
  {
    checkInId: { type: Schema.Types.ObjectId, ref: 'CheckIn', required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', index: true },
    scheduledFor: { type: Date, required: true, index: true },
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    triggeredByUid: { type: String },
    status: {
      type: String,
      enum: ['queued', 'sent', 'acknowledged', 'missed', 'failed'],
      default: 'queued',
      index: true,
    },
    channel: { type: String, enum: ['sms', 'push', 'manual'], default: 'sms' },
    responseAt: { type: Date },
    location: { type: PingLocationSchema, default: null },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

CheckInPingSchema.index({ scheduledFor: 1, status: 1 });

const CheckInPing = model('CheckInPing', CheckInPingSchema);
export default CheckInPing;
