import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/routes/utils/authz.js', () => ({
  assertPermission: () => {},
  filterByDepartment: (q) => q,
  hasPermission: () => true,
}));

let CaseModel;
let CaseEnrichmentModel;
let mockProvider;

// Mock mongoose connection to bypass ensureMongoConnected()
vi.mock('mongoose', () => {
  class FakeObjectId {}
  class FakeSchema {
    static Types = { ObjectId: FakeObjectId, Mixed: Object };
    constructor(def) { this.def = def; this._virtuals = new Map(); this.methods = {}; this._indexes = []; }
    virtual(name) { const v = { get: () => v, set: () => v }; this._virtuals.set(name, v); return v; }
    pre() { return this; }
    index(spec) { this._indexes.push(spec); return this; }
  }
  const model = () => ({ findOne: vi.fn(), aggregate: vi.fn(), create: vi.fn() });
  return {
    default: {
      connection: { readyState: 1 },
      Types: { ObjectId: FakeObjectId },
      Schema: FakeSchema,
      model,
    },
  };
});

vi.mock('../src/models/Case.js', async () => {
  const updateOne = vi.fn();
  const findOne = vi.fn();
  const findOneAndUpdate = vi.fn(() => ({ lean: () => ({ exec: () => Promise.resolve({ _id: '507f1f77bcf86cd799439011', crm_details: {} }) }) }));
  const aggregate = vi.fn(() => ({ option: () => ({ exec: () => Promise.resolve([]) }) }));
  CaseModel = { updateOne, findOne, findOneAndUpdate, aggregate };
  return { default: CaseModel };
});

vi.mock('../src/models/CaseEnrichment.js', async () => {
  const create = vi.fn();
  const findOne = vi.fn();
  CaseEnrichmentModel = { create, findOne };
  return { default: CaseEnrichmentModel };
});

vi.mock('../src/lib/enrichment/registry.js', () => {
  mockProvider = {
    id: 'whitepages',
    label: 'Whitepages',
    ttlMinutes: 60,
    errorTtlMinutes: 15,
    supportsForce: false,
    search: vi.fn(async () => ({
      status: 'success',
      candidates: [
        {
          recordId: 'cand1',
          fullName: 'John Doe',
          score: 0.9,
          contacts: [{ type: 'phone', value: '+1-555-0100' }],
          addresses: [{ streetLine1: '1 Main', city: 'Houston', stateCode: 'TX', postalCode: '77001' }],
        },
      ],
    })),
  };

  return {
    listProviders: vi.fn(() => [mockProvider]),
    getProvider: vi.fn((id) => (id === mockProvider.id ? mockProvider : null)),
    getDefaultProviderId: vi.fn(() => mockProvider.id),
  };
});

const { default: buildRouter } = await import('../src/routes/cases.js');
import express from 'express';
import request from 'supertest';

function makeApp() {
  const app = express();
  app.use(express.json());
  // inject fake auth
  app.use((req, _res, next) => { req.user = { uid: 'u1', roles: ['cases:read','cases:write','cases:enrich'] }; next(); });
  app.use('/cases', buildRouter);
  return app;
}

describe('Cases CRM + Enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCH /cases/:id/crm updates phone and address', async () => {
    CaseModel.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    CaseModel.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', crm_details: {} });

    const app = makeApp();
    const res = await request(app)
      .patch('/cases/507f1f77bcf86cd799439011/crm')
      .send({ phone: '+1-555-0111', address: { city: 'Houston', stateCode: 'TX', postalCode: '77001' } });

    expect(res.status).toBeLessThan(400);
    expect(CaseModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'crm_details.phone': '+1-555-0111',
          'crm_details.address': expect.objectContaining({ city: 'Houston' }),
        }),
      }),
      expect.objectContaining({ new: true })
    );
  });

  it('Enrichment latest/run/select flow', async () => {
    const caseId = '507f1f77bcf86cd799439011';
    // latest: none
    CaseEnrichmentModel.findOne
      .mockResolvedValueOnce(null) // for GET latest
      .mockResolvedValueOnce(null) // for POST run: latest cache check
      .mockResolvedValueOnce({     // for POST select: latest enrichment with candidates
        _id: 'enr1',
        provider: 'whitepages',
        candidates: [{ recordId: 'cand1' }],
        selectedRecords: [],
        save: vi.fn().mockResolvedValue(undefined),
        toObject() { return { id: 'enr1', provider: 'whitepages', candidates: [{ recordId: 'cand1' }], selectedRecords: [] }; },
      });

    CaseModel.findOne.mockResolvedValue({ _id: caseId, full_name: 'John Doe', crm_details: { phone: '+1-555-0100' } });
    CaseEnrichmentModel.create.mockResolvedValue({
      toObject() { return { id: 'enr1', provider: 'whitepages', status: 'ok', candidates: [{ recordId: 'cand1' }], params: { fullName: 'John Doe' } }; },
      candidates: [{ recordId: 'cand1' }],
    });

    const app = makeApp();

    const providersRes = await request(app).get('/cases/enrichment/providers');
    expect(providersRes.status).toBe(200);
    expect(providersRes.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whitepages', default: true }),
    ]));

    const latest = await request(app).get(`/cases/${caseId}/enrichment/whitepages`);
    expect(latest.status).toBe(200);
    expect(latest.body).toEqual({ enrichment: null, cached: false, nextRefreshAt: null });

    const run = await request(app).post(`/cases/${caseId}/enrichment/whitepages`).send({});
    expect(run.status).toBe(200);
    expect(mockProvider.search).toHaveBeenCalled();
    expect(run.body.enrichment).toBeTruthy();

    const select = await request(app).post(`/cases/${caseId}/enrichment/whitepages/select`).send({ recordId: 'cand1' });
    expect(select.status).toBe(200);
  });
});
