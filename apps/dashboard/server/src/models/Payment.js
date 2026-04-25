import mongoose from 'mongoose';

const { Schema, connection } = mongoose;

const PaymentSchema = new Schema(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    externalReference: { type: String, default: '' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'usd' },
    fees: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    method: {
      type: String,
      enum: ['card', 'ach_debit', 'wire', 'cash', 'check', 'other'],
      default: 'card',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'disputed'],
      default: 'pending',
      index: true,
    },
    description: { type: String, default: '' },
    bondNumber: { type: String, default: '' },
    clientName: { type: String, default: '' },
    clientEmail: { type: String, default: '' },
    clientId: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByUid: { type: String, default: '' },
    stripePaymentIntentId: { type: String, default: '', index: true },
    stripeCustomerId: { type: String, default: '' },
    stripeChargeId: { type: String, default: '' },
    processedAt: { type: Date },
    refundedAt: { type: Date },
    disputedAt: { type: Date },
    metadata: { type: Map, of: String, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
    toObject: { versionKey: false },
  }
);

PaymentSchema.index({ createdAt: -1 });
PaymentSchema.index({ bondNumber: 1 });

const modelName = 'Payment';

export default connection.models[modelName]
  ? connection.models[modelName]
  : connection.model(modelName, PaymentSchema, 'payments');
