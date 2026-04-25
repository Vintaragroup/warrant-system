import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function EnrichWidget() {
  const [selected, setSelected] = useState<string>('');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [auto, setAuto] = useState(false);

  async function runEnrich() {
    const resp = await fetch('/api/enrichment/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectIds: selected.split(',').map((s) => s.trim()).filter(Boolean) }) });
    const j = await resp.json();
    setJobIds(j.jobIds || []);
  }

  useEffect(() => {
    const t = setInterval(async () => {
      for (const id of jobIds) {
        const r = await fetch(`/api/enrichment/status?jobId=${encodeURIComponent(id)}`);
        if (r.ok) {
          const j = await r.json();
          setStatuses((s) => ({ ...s, [id]: j }));
        }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [jobIds]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h3>Enrich Selected</h3>
      <input placeholder="subjectIds comma-separated" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: 400 }} />
      <button onClick={runEnrich} style={{ marginLeft: 8 }}>Enrich</button>
      <label style={{ marginLeft: 16 }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-enrich new matches (72h)
      </label>
      <div style={{ marginTop: 16 }}>
        {jobIds.map((id) => (
          <div key={id} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 8 }}>
            <div>Job {id}</div>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(statuses[id] || {}, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<EnrichWidget />);
