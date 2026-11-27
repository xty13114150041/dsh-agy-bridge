// Pure model/usage parsing and the incremental cursor kept for each DSH session.
export const MODES = ['default', 'accept-edits', 'auto', 'plan'];
export const PROVIDER_NAME = 'Google Antigravity CLI';
export const CONTEXT_WINDOW = 1_048_576;

const EFFORT_NAMES = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh' };
const EFFORT_ORDER = Object.keys(EFFORT_NAMES);
const MODEL_EFFORT = /-(low|medium|high|xhigh)$/;

export function parseModels(tsv) {
  const families = new Map();
  for (const line of tsv.trim().split(/\r?\n/)) {
    const [slug, display, extra] = line.split('\t');
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(slug) || !display || extra !== undefined) throw new Error('Unexpected `agy models` TSV');
    const effort = slug.match(MODEL_EFFORT)?.[1] ?? '';
    const id = slug.replace(MODEL_EFFORT, '');
    const name = effort ? display.replace(/\s*\((?:low|medium|high|xhigh)\)$/i, '') : display;
    const family = families.get(id) ?? { id, name, slugs: {} };
    family.slugs[effort] = slug;
    families.set(id, family);
  }
  return [...families.values()].map(family => {
    const levels = EFFORT_ORDER.filter(id => family.slugs[id]);
    const defaultEffort = levels.findLast(id => id !== 'xhigh') ?? levels[0];
    return { ...family, levels, defaultEffort };
  });
}

export function visibleModels(families, hiddenModels) {
  const hidden = new Set(hiddenModels);
  const visible = families.filter(model => !hidden.has(model.id));
  // A newer CLI can remove the last visible family. Keep a usable picker in that case.
  return visible.length ? visible : families;
}

export function validateHiddenModels(families, hiddenModels) {
  const ids = new Set(families.map(model => model.id));
  if (hiddenModels.some(id => !ids.has(id))) throw new Error('模型清单变了，请刷新后再保存。');
  if (new Set(hiddenModels).size >= ids.size) throw new Error('至少保留一个可见模型。');
}

export function modelRoute(families, id) {
  const family = families.find(model => model.id === id || Object.values(model.slugs).includes(id));
  if (!family) throw Object.assign(new Error(`agy 当前没有模型 ${id}；请刷新目录并重新选择。`), { code: 'UNKNOWN_MODEL' });
  const legacyEffort = family.levels.find(effort => family.slugs[effort] === id);
  const fallback = legacyEffort ?? family.defaultEffort;
  return {
    info(provider) {
      const reasoning = family.levels.length > 1 ? {
        efforts: family.levels.map(id => ({ id, name: EFFORT_NAMES[id] })), defaultEffort: fallback,
      } : undefined;
      return { provider, id, name: `agy-${family.name}`, inputModalities: ['text'], context: { contextWindow: CONTEXT_WINDOW }, ...(reasoning ? { reasoning } : {}) };
    },
    slug(effort) {
      if (effort !== undefined && (family.levels.length < 2 || !family.levels.includes(effort))) {
        const available = family.levels.join(' / ');
        throw Object.assign(new Error(`agy 模型 ${id} 不支持思考档位 ${effort}。${available ? `实际档位：${available}。` : '此模型没有可选档位。'}`),
          { code: 'UNSUPPORTED_REASONING_EFFORT' });
      }
      return family.slugs[effort ?? fallback ?? ''];
    },
  };
}

export function parseQuota(tsv) {
  const groups = { 'Gemini Models': 'gemini', 'Claude and GPT models': 'claudeGpt' };
  const periods = { 'Five Hour Limit Remaining': 'fiveHours', 'Weekly Limit Remaining': 'week' };
  const seen = new Set();
  const rows = tsv.trim().split(/\r?\n/).map(line => {
    const [name, metric, percent, resetAt, extra] = line.split('\t');
    const group = groups[name], period = periods[metric];
    const remaining = Number(percent?.slice(0, -1));
    if (!Object.hasOwn(groups, name) || !Object.hasOwn(periods, metric) || !/^\d+(?:\.\d+)?%$/.test(percent)
      || remaining < 0 || remaining > 100 || !Number.isFinite(Date.parse(resetAt)) || extra !== undefined) {
      throw new Error('Unexpected `agy -p /usage` TSV');
    }
    const key = `${group}/${period}`;
    if (seen.has(key)) throw new Error(`Duplicate agy quota row: ${key}`);
    seen.add(key);
    return { group, period, remaining, resetAt };
  });
  if (rows.length !== 4) throw new Error('Expected four agy quota rows');
  return rows;
}

export function failureOf(error) {
  const message = error?.message || String(error);
  const detail = `${message} ${JSON.stringify(error?.data ?? '')}`;
  if (error?.rpcCode === -32000 && /auth/i.test(detail) || /\bauth(?:entication)?[ _-]required\b|unauthenticated|not (?:logged|signed) in|login required|\b401\b/i.test(detail)) {
    return { code: 'AUTH', message: `${message} — 请在终端运行 agy 或 agy acp --login 登录。` };
  }
  if (/quota|usage[ -]limit|resource_exhausted/i.test(detail)) return { code: 'QUOTA', message };
  if (/rate[ _-]limit|too many requests|\b429\b/i.test(detail)) return { code: 'RATE_LIMIT', message };
  return { code: ['INVALID_CONFIG', 'INVALID_REQUEST', 'UNKNOWN_MODEL', 'UNSUPPORTED_REASONING_EFFORT', 'UNSUPPORTED_CONTENT', 'TIMEOUT', 'TRANSPORT', 'MALFORMED_RESPONSE'].includes(error?.code) ? error.code : 'UNKNOWN', message };
}

// agy already reports input and cached tokens disjointly (total = input + output + cachedRead),
// and its totals add up every model step of a turn. `contextUsed` is the live context size from
// agy's usage_update; when the summed prompt side exceeds it (tool turns), input and cache are
// scaled down together so DSH's context ring matches the CLI. Output and thought tokens stay exact.
export function tokenUsage(usage, contextUsed) {
  if (!usage || !Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) return undefined;
  const { outputTokens, totalTokens, thoughtTokens: reasoningTokens } = usage;
  let [inputTokens, cacheReadTokens, cacheWriteTokens] = [usage.inputTokens, usage.cachedReadTokens, usage.cachedWriteTokens];
  const prompt = inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  const room = Number.isFinite(contextUsed) ? Math.max(0, contextUsed - outputTokens) : prompt;
  const scaled = prompt > room && prompt > 0;
  if (scaled) {
    const ratio = room / prompt;
    inputTokens = Math.round(inputTokens * ratio);
    if (Number.isFinite(cacheReadTokens)) cacheReadTokens = Math.round(cacheReadTokens * ratio);
    if (Number.isFinite(cacheWriteTokens)) cacheWriteTokens = Math.round(cacheWriteTokens * ratio);
  }
  return { inputTokens, outputTokens,
    ...Object.fromEntries(Object.entries({ totalTokens: scaled ? undefined : totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens }).filter(([, n]) => Number.isFinite(n))) };
}

export const messageText = message => message?.content.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';

export function conversationMessages(messages) {
  // DSH wraps its system-owned runtime snapshot (incl. workspace instructions/tool lists) as user-role.
  return messages.filter(m => (m.role === 'user' || m.role === 'assistant') && m.source?.kind !== 'runtime-context');
}

export function renderHistory(messages) {
  return messages.map(m => {
    const text = messageText(m);
    return text && `${m.role === 'user' ? 'User' : 'Assistant'}:\n${text}`;
  }).filter(Boolean).join('\n\n');
}

export function planPrompt(messages, previous, { purpose, system, forceNew = false } = {}) {
  const history = conversationMessages(messages);
  const ids = history.map(m => m.id ?? null);
  const last = messageText(history.at(-1));
  const cursor = { ids, last };
  // After a successful ACP prompt, verify the committed DSH assistant text before trusting that history.
  const count = previous?.ids?.length ?? 0;
  const prefix = !!previous?.ids && count <= history.length && previous.ids.every((id, i) => id === ids[i])
    && previous.last === messageText(history[count - 1]);
  const after = history.slice(count);
  // An interrupted turn can leave an empty reply that DSH never commits as an assistant message.
  const expectsReply = previous?.reply !== undefined && !(previous.reply === '' && after[0]?.role !== 'assistant');
  const replyAgrees = !expectsReply || (after[0]?.role === 'assistant' && messageText(after[0]) === previous.reply);
  const pending = after.slice(expectsReply ? 1 : 0);
  // Messages steered into the previous turn were already answered there.
  const steered = new Set(previous?.steered ?? []);
  const delta = pending.filter(m => !steered.has(m.id));
  const reuse = !purpose && !forceNew && prefix && !previous.dirty && replyAgrees && delta.every(m => m.role === 'user');
  // Same request after success but before the loop commits the assistant: no resend to that ACP session.
  if (!purpose && !forceNew && prefix && !previous.dirty && after.length === 0) return { reuse: true, text: '', cursor };
  if (!purpose && !forceNew && prefix && !previous.dirty && replyAgrees && pending.length && !delta.length) return { reuse: true, text: '', cursor, steered: true };
  if (purpose) {
    const text = renderHistory(history);
    return { reuse: false, cursor, text: [system && `[任务指令]\n${system}\n[/任务指令]`, text].filter(Boolean).join('\n\n') };
  }
  const boundary = history.findLastIndex(m => m.role === 'assistant') + 1;
  const active = reuse ? delta : history.slice(boundary);
  const prior = renderHistory(history.slice(0, boundary));
  const latestUser = active.findLast(m => m.source?.kind === 'user');
  const command = messageText(latestUser).match(/^\/agy\s+(.+)$/s)?.[1];
  if (command) {
    // A native command needs an exact first prompt; extra prose would be parsed as command arguments.
    if (!reuse && prior) return { reuse, cursor, error: 'agy 需要先重建会话历史。请先发送普通消息，然后重新运行 /agy 命令。' };
    return { reuse, cursor, text: `/${command}` };
  }
  const text = active.map(messageText).filter(t => t.trim()).join('\n\n');
  if (!text) return { reuse, cursor, text };
  return { reuse, cursor, text: !reuse && prior ? `[DSH conversation history]\n${prior}\n[/DSH conversation history]\n\n${text}` : text };
}

export function permissionDescription(toolCall = {}) {
  const title = toolCall.title || toolCall.name || toolCall.kind || toolCall.toolCallId || 'agy tool';
  const input = toolCall.rawInput === undefined ? '' : JSON.stringify(toolCall.rawInput, null, 2);
  const paths = (toolCall.locations ?? []).map(({ path, line }) => line == null ? path : `${path}:${line}`).join('\n');
  const content = (toolCall.content ?? []).map(item => {
    if (item.type === 'content' && item.content?.type === 'text') return item.content.text;
    if (item.type === 'diff') return [item.path, item.oldText, item.newText].filter(v => typeof v === 'string').join('\n');
    return '';
  }).filter(Boolean).join('\n');
  return { title, detail: [input, paths, content].filter(Boolean).join('\n\n') || title };
}

// agy asks questions through ACP elicitation/create (form mode): one property per question, plus an optional
// "<key>_other" free-text companion. Map them to DSH question cards and the answers back to form content.
export function elicitationQuestions(params) {
  const properties = params?.requestedSchema?.properties ?? {};
  const questions = [];
  const fields = new Map();
  for (const [key, field] of Object.entries(properties)) {
    if (key.endsWith('_other') && Object.hasOwn(properties, key.slice(0, -6))) continue;
    const many = field.type === 'array';
    const choices = (many ? field.items : field)?.oneOf ?? (many ? field.items : field)?.anyOf
      ?? ((many ? field.items : field)?.enum ?? []).map(value => ({ const: value, title: String(value) }));
    const options = choices.map(choice => ({ value: choice.const, label: String(choice.title ?? choice.const) }));
    if (new Set(options.map(option => option.label)).size !== options.length) return undefined;
    questions.push({
      id: key, question: field.title ?? key, header: 'Google Antigravity CLI',
      ...options.length ? { options: options.map(({ label }) => ({ label })) } : {},
      ...many ? { multiSelect: true } : {},
    });
    fields.set(key, { options, many, other: Object.hasOwn(properties, `${key}_other`) });
  }
  return questions.length ? { questions, fields } : undefined;
}

export function elicitationResult(answer, { fields }) {
  const content = {};
  for (const [key, { options, many, other }] of fields) {
    const item = answer?.answers?.find(entry => entry.id === key);
    if (!item) continue;
    const values = (item.selected ?? []).map(label => options.find(option => option.label === label)?.value).filter(value => value !== undefined);
    if (values.length) content[key] = many ? values : values[0];
    const custom = item.custom?.trim();
    if (custom) content[other ? `${key}_other` : key] = custom;
  }
  return Object.keys(content).length ? { action: 'accept', content } : { action: 'decline' };
}
