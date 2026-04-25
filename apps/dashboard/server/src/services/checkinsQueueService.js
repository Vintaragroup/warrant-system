import mongoose from 'mongoose';
import CheckIn from '../models/CheckIn.js';
import { getGpsQueue } from '../jobs/checkins.js';

const GPS_QUEUE_NAME = 'checkins_gps';
const TEST_INTERVAL_MINUTES = Number(process.env.CHECKINS_GPS_INTERVAL_MINUTES || 5);

function ensureObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value);
  return null;
}

function computeScheduleWindows(checkIn) {
  const count = Math.min(Math.max(Number(checkIn.pingsPerDay) || 3, 1), 12);
  const base = Date.now();
  const intervalMinutes = Math.max(1, Math.round(TEST_INTERVAL_MINUTES));
  const windows = [];
  for (let i = 1; i <= count; i += 1) {
    windows.push(base + i * intervalMinutes * 60 * 1000);
  }
  return windows;
}

async function removeExistingJobs(queue, jobItems = []) {
  if (!queue || !Array.isArray(jobItems)) return;
  await Promise.all(
    jobItems.map(async (item) => {
      if (!item?.jobId) return;
      try {
        await queue.remove(item.jobId);
      } catch (err) {
        console.warn('Failed to remove GPS job', item.jobId, err?.message || err);
      }
    }),
  );
}

export async function refreshGpsSchedule(checkInId) {
  const queue = getGpsQueue();
  if (!queue) {
    console.warn('GPS queue unavailable; skipping schedule refresh');
    return;
  }

  const objectId = ensureObjectId(checkInId);
  if (!objectId) return;

  const doc = await CheckIn.findById(objectId);
  if (!doc) return;

  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const existingJobs = Array.isArray(meta.gpsJobs?.items) ? meta.gpsJobs.items : [];
  await removeExistingJobs(queue, existingJobs);

  if (!doc.gpsEnabled) {
    doc.meta = { ...meta, gpsJobs: { queue: GPS_QUEUE_NAME, items: [] } };
    doc.markModified('meta');
    await doc.save();
    return;
  }

  const schedule = computeScheduleWindows(doc).filter((ts) => Number.isFinite(ts));
  const items = [];

  await Promise.all(
    schedule.map(async (timestamp, index) => {
      try {
        const delay = Math.max(0, timestamp - Date.now());
        const job = await queue.add(
          'gps-auto',
          {
            checkInId: doc._id.toString(),
            clientId: doc.clientId ? doc.clientId.toString() : null,
            scheduledFor: new Date(timestamp).toISOString(),
            reason: 'auto-schedule',
            ordinal: index + 1,
          },
          {
            delay,
            removeOnComplete: 250,
            removeOnFail: false,
          },
        );
        items.push({ jobId: job.id, scheduledFor: new Date(timestamp).toISOString(), ordinal: index + 1 });
      } catch (err) {
        console.error('Failed to enqueue GPS job', err?.message || err);
      }
    }),
  );

  doc.meta = { ...meta, gpsJobs: { queue: GPS_QUEUE_NAME, items } };
  doc.markModified('meta');
  await doc.save();
}

export async function refreshGpsScheduleForDocument(document) {
  if (!document || !document._id) return;
  await refreshGpsSchedule(document._id);
}
