import mongoose, { Schema } from 'mongoose';

const RelatedPartySchema = new Schema(
  {
    subjectId: { type: String, index: true },
    partyId: { type: String, index: true },
    name: String,
    relationType: { type: String, enum: ['family', 'household', 'associate', 'unknown'], default: 'unknown' },
    confidence: Number,
    evidence: [
      new Schema(
        {
          type: String,
          value: String,
          weight: Number,
          provider: String,
        },
        { _id: false }
      ),
    ],
    contacts: new Schema(
      {
        phones: [String],
        emails: [String],
      },
      { _id: false }
    ),
    addresses: [String],
    sources: [String],
  },
  { timestamps: true }
);

export const RelatedPartyModel = mongoose.models.related_parties || mongoose.model('related_parties', RelatedPartySchema, 'related_parties');
