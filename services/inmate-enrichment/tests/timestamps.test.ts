import { parseTimestamp, getIngestionTimestamp } from '../shared/src/timestamps';

test('parseTimestamp handles ISO and epoch', () => {
  const iso = parseTimestamp('2024-01-01T00:00:00Z');
  expect(iso).toBeTruthy();
  const epoch = parseTimestamp(1704067200); // seconds
  expect(epoch).toBeTruthy();
});

test('getIngestionTimestamp picks first available', () => {
  const doc = { fetched_at: '2023-01-02', scraped_at: '2023-01-01' };
  const ts = getIngestionTimestamp(doc);
  expect(ts).toBeTruthy();
});
