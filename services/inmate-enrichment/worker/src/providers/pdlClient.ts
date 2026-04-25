import axios from 'axios';
import pRetry from 'p-retry';
import { config, logger, RawProviderPayloadModel } from '@inmate/shared';
import { createHash } from 'crypto';

function hashQuery(obj: any): string {
  const s = JSON.stringify(obj || {});
  return createHash('sha1').update(s).digest('hex');
}

export async function pdlSearch(subject: any): Promise<any> {
  if (!config.pdlApiKey) {
    logger.warn('PDL API key missing; using demo payload');
    return {
      data: {
        matches: [
          { '@match': 0.86, phones: ['+1 (281) 555-1234'], addresses: [{ street: '123 Main St, Houston, TX' }], usernames: ['john_doe_tx'], user_ids: ['tw:123'] },
          { '@match': 0.62, phones: ['+1 (832) 555-9999'] },
        ],
      },
    };
  }
  const url = 'https://api.peopledatalabs.com/v5/person/enrich';
  const params = { name: `${subject.first_name || ''} ${subject.last_name || ''}`.trim(), location: `${subject.city || ''}, ${subject.state || ''}`.trim(), dob: subject.dob || undefined };
  const qh = hashQuery(params);
  const cacheKey = `pdl:${String(subject.spn || subject.subject_id || subject.subjectId || '')}:${qh}`;
  const cached: any = await RawProviderPayloadModel.findOne({ provider: 'pdl', step: 'pdl_search', 'payload.cacheKey': cacheKey, ttlExpiresAt: { $gte: new Date() } }).sort({ createdAt: -1 }).lean();
  if (cached?.payload?.data) {
    logger.info('PDL cache hit', { cacheKey });
    // Record cache-hit event for visibility
    try {
      await RawProviderPayloadModel.create({ provider: 'pdl', step: 'pdl_search', payload: { cacheKey, fromCache: true }, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
    } catch {}
    return cached.payload;
  }
  const attempt = async () => {
    const resp = await axios.get(url, {
      headers: { 'X-API-Key': config.pdlApiKey! },
      params,
      timeout: 10000,
    });
    const payload = { cacheKey, data: { matches: resp.data?.data ? [resp.data.data] : [] } };
    await RawProviderPayloadModel.create({ provider: 'pdl', step: 'pdl_search', payload, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
    return payload;
  };
  return pRetry(attempt, { retries: (config as any).providerMaxRetries || 2 });
}

export async function pdlReverseAddress(addresses: any[]): Promise<any> {
  if (!config.pdlApiKey) {
    return { data: addresses.map((a) => ({ address: a, residents: 2 })) };
  }
  // Placeholder reverse address using same enrich endpoint parameters
  return { data: addresses.map((a) => ({ address: a, residents: 2 })) };
}

export async function pdlReversePhone(phones: string[]): Promise<any> {
  if (!config.pdlApiKey) {
    return { data: phones.map((p) => ({ phone: p, owner: 'Unknown' })) };
  }
  // Placeholder reverse phone
  return { data: phones.map((p) => ({ phone: p, owner: 'Unknown' })) };
}
