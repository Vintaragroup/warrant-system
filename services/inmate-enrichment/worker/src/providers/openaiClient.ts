import { config, logger } from '@inmate/shared';
import OpenAI from 'openai';

export async function socialScan({ chosen, subject }: { chosen: any; subject: any }) {
  const usernames: string[] = chosen?.usernames || [];
  const name = `${subject.first_name || ''} ${subject.last_name || ''}`.trim();
  if (!config.openaiApiKey) {
    logger.warn('OpenAI API key missing; using demo payload');
    // simple deterministic score
    const score = usernames.length > 0 ? 0.75 : 0.4;
    return { data: { score, usernames } };
  }
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const prompt = `Assess if usernames ${JSON.stringify(usernames)} likely belong to ${name}. Return a JSON with {score:0..1}.`;
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  });
  const text = resp.choices?.[0]?.message?.content || '{"score":0.5}';
  let score = 0.5;
  try {
    const obj = JSON.parse(text);
    score = typeof obj.score === 'number' ? obj.score : 0.5;
  } catch {
    // ignore
  }
  return { data: { score, usernames } };
}
