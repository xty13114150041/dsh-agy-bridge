// Bridge ACP options to the public DSH approval waterfall. No tool is registered in DSH.
const byKind = (options, kind) => {
  const matches = options.filter(option => option.kind === kind);
  return matches.length === 1 ? matches[0] : undefined;
};
const wasAllowed = option => ['allow_once', 'allow_always'].includes(option?.kind);
const wasRejected = option => ['reject_once', 'reject_always'].includes(option?.kind);

export function permissionQuestion(title, detail, options) {
  const repeated = new Set();
  const seen = new Set();
  for (const option of options) {
    if (seen.has(option.name)) repeated.add(option.name);
    seen.add(option.name);
  }
  // DSH answers name labels, not opaque ids; disambiguate only repeated labels.
  const labels = options.map(option => repeated.has(option.name) ? `${option.name} (${option.optionId})` : option.name);
  if (!labels.length || new Set(labels).size !== labels.length) return undefined;
  const question = {
    id: 'dsh-agy-bridge-permission', question: `agy 请求权限：${title}`, header: 'Google Antigravity CLI',
    detail: detail.split('\n').map(line => `    ${line}`).join('\n'),
    options: labels.map(label => ({ label })),
  };
  const labelOf = kind => labels[options.indexOf(byKind(options, kind))];
  const allow = labelOf('allow_once');
  const reject = labelOf('reject_once');
  const always = labelOf('allow_always');
  if (allow && reject && options.length === (always ? 3 : 2)) {
    question.intent = { kind: 'approval', approve: allow, reject, ...(always ? { always } : {}), subject: { name: 'agy' } };
  }
  return question;
}

export function selectedPermission(answer, question, options) {
  const chosen = answer?.answers?.find(item => item.id === question.id);
  if (!chosen || chosen.custom || chosen.selected?.length !== 1) return undefined;
  return options[question.options.findIndex(option => option.label === chosen.selected[0])];
}

export function approvalDecision(outcome, options, humanChoice) {
  if (outcome === 'allowed-once') {
    const allow = wasAllowed(humanChoice) ? humanChoice : byKind(options, 'allow_once');
    if (allow) return { outcome: 'selected', optionId: allow.optionId };
  }
  if (outcome === 'rejected' && wasRejected(humanChoice)) return { outcome: 'selected', optionId: humanChoice.optionId };
  const deny = byKind(options, 'reject_once');
  return deny ? { outcome: 'selected', optionId: deny.optionId } : { outcome: 'cancelled' };
}

export function createPermissionBridge(ctx, timeoutMs = 120_000) {
  const extended = new WeakMap();
  // The request is borrowed by approval.request. Claim only the exact same
  // process-local request; all other Agent/tool approvals keep existing answerers.
  ctx.on('approval/request', async (request, next) => {
    const state = extended.get(request);
    if (!state) return next();
    const userQuestions = ctx.get('userQuestions');
    const question = permissionQuestion(state.title, state.detail, state.options);
    if (!userQuestions || !question || request.signal.aborted) return 'unavailable';
    const answer = await userQuestions.ask({ agent: request.agent, signal: request.signal, questions: [question] });
    if (request.signal.aborted) return 'cancelled';
    state.choice = selectedPermission(answer, question, state.options);
    return wasAllowed(state.choice) ? 'allowed-once' : 'rejected';
  }, { prepend: true });

  return async (agent, { title, detail, options, toolName }, signal) => {
    if (signal.aborted) return { response: { outcome: 'cancelled' } };
    if (agent && agent.session.header.origin !== 'subagent') {
      const presets = ctx.get('permissionPresets');
      const approval = ctx.get('approval');
      const once = byKind(options, 'allow_once');
      if (once && presets?.current(agent.session) === 'danger-full-access'
        && presets.resolve('danger-full-access').approval === 'never') {
        // Native "never" means deny inside DSH's SDK; an explicit Full access
        // preset expresses the user's choice for this external bridge only.
        return { response: { outcome: 'selected', optionId: once.optionId }, notice: `全权限预设：已自动允许 ${title}` };
      }
      if (approval) {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
        const subject = detail === title ? title : `${title} — ${detail}`;
        const req = {
          agent, toolName: `agy: ${toolName || title}`, reason: `agy 请求权限：${subject}`,
          displayReason: { en: `agy requests permission: ${subject}`, zh: `agy 请求权限：${subject}` }, signal: deadline,
        };
        // An ordinary approval card has two actions. Reuse it only when both
        // options have exact one-shot equivalents, otherwise preserve them all.
        const state = options.length === 2 && once && byKind(options, 'reject_once') ? undefined : { title, detail, options };
        if (state) extended.set(req, state);
        let outcome;
        try { outcome = await approval.request(req); }
        catch { outcome = 'unavailable'; }
        finally { extended.delete(req); }
        if (signal.aborted) return { response: { outcome: 'cancelled' } };
        if (!deadline.aborted) return {
          response: approvalDecision(outcome, options, state?.choice),
          notice: outcome === 'allowed-once' && (wasAllowed(state?.choice) || once) ? undefined : `agy 请求权限：${title}。未获得批准。`,
        };
      }
    }
    return { response: approvalDecision('unavailable', options), notice: `agy 请求权限：${title}。审批不可用或已超时，未获得批准。` };
  };
}

// agy's own questions (ask_question) are shown on DSH's built-in question card.
export function createQuestionBridge(ctx) {
  return async (agent, questions, signal) => {
    const userQuestions = ctx.get('userQuestions');
    if (!userQuestions || !agent || agent.session.header.origin === 'subagent' || signal.aborted) return undefined;
    return userQuestions.ask({ agent, signal, questions });
  };
}
