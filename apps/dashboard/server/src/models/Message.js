import mongoose from 'mongoose';
const { Schema, model } = mongoose;

/** Loose E.164 validator e.g. +15551234567 */
const E164 = /^\+?[1-9]\d{1,14}$/;

/** Normalize phone-like strings by removing spaces and non-digits except leading '+' */
function normalizeE164(value) {
  if (!value) return value;
  const v = String(value).trim();
  // keep a single leading +, strip everything else that isn't a digit
  const plus = v.startsWith('+') ? '+' : '';
  return plus + v.replace(/[^\d]/g, '');
}

const MessageSchema = new Schema(
  {
    // Linkage
    caseId:   { type: Schema.Types.ObjectId, ref: 'Case', index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', index: true },

    // Direction & channel
    direction: { type: String, enum: ['out', 'in'], required: true, index: true },
    channel:   { type: String, enum: ['sms', 'voice'], required: true, index: true },

    // Endpoints (E.164 for sms/voice)
    to: {
      type: String,
      match: E164,
      index: true,
      sparse: true,
      set: normalizeE164,
      trim: true,
    },
    from: {
      type: String,
      match: E164,
      index: true,
      sparse: true,
      set: normalizeE164,
      trim: true,
    },

    // Content
    body: { type: String, trim: true },

    // State
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'delivered', 'failed'],
      index: true,
      default: 'queued',
      required: true,
    },
    attempts:    { type: Number, default: 0, min: 0 },
    scheduledAt: { type: Date, index: true },
    sentAt:      { type: Date, index: true },
    deliveredAt: { type: Date, index: true },
    readAt:      { type: Date },

    // Provider details / diagnostics
    provider:          { type: String, trim: true }, // e.g., 'twilio'
    providerMessageId: { type: String, index: true, sparse: true, trim: true },
    errorCode:         { type: String, trim: true },
    errorMessage:      { type: String, trim: true },

    // Extra payload for future-proofing
    meta: Schema.Types.Mixed,
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
  }
);

// --- Virtuals ---
/** ms between sent and delivered */
MessageSchema.virtual('deliveryMs').get(function () {
  if (!this.sentAt || !this.deliveredAt) return null;
  return new Date(this.deliveredAt) - new Date(this.sentAt);
});

/** Whether the message is in a terminal state */
MessageSchema.virtual('isTerminal').get(function () {
  return this.status === 'delivered' || this.status === 'failed';
});

// --- Hooks ---
/** Ensure timestamps align with status if caller forgets to set them */
MessageSchema.pre('save', function (next) {
  const now = new Date();
  if (this.isModified('status')) {
    if (this.status === 'sent' && !this.sentAt) this.sentAt = now;
    if (this.status === 'delivered' && !this.deliveredAt) this.deliveredAt = now;
  }
  next();
});

// --- Instance helpers ---
MessageSchema.methods.markQueued = function () {
  this.status = 'queued';
  return this.save();
};

MessageSchema.methods.markSending = function () {
  this.status = 'sending';
  this.attempts = (this.attempts || 0) + 1;
  return this.save();
};

MessageSchema.methods.markSent = function (providerMessageId) {
  this.status = 'sent';
  this.sentAt = new Date();
  if (providerMessageId) this.providerMessageId = providerMessageId;
  return this.save();
};

MessageSchema.methods.markDelivered = function () {
  this.status = 'delivered';
  this.deliveredAt = new Date();
  return this.save();
};

MessageSchema.methods.markFailed = function (errorCode, errorMessage) {
  this.status = 'failed';
  this.errorCode = errorCode != null ? String(errorCode) : this.errorCode;
  this.errorMessage = errorMessage ?? this.errorMessage;
  this.attempts = (this.attempts || 0) + 1;
  return this.save();
};

// --- Indexes for common dashboards/queries ---
MessageSchema.index({ caseId: 1, createdAt: -1 });
MessageSchema.index({ personId: 1, createdAt: -1 });
MessageSchema.index({ status: 1, channel: 1, createdAt: -1 });
MessageSchema.index({ direction: 1, channel: 1, createdAt: -1 });
MessageSchema.index({ scheduledAt: -1 });
MessageSchema.index({ sentAt: -1 });
MessageSchema.index({ deliveredAt: -1 });
// Full-text search on body (optional but handy)
MessageSchema.index({ body: 'text' });

const Message = model('Message', MessageSchema);
export { MessageSchema };
export default Message;