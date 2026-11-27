window.__ModuleLoader__.load({
  id: 'dsh-agy-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-agy-bridge';
    const dictionaries = {
      zh: {
        nav: 'Antigravity CLI', title: 'Antigravity CLI Bridge', intro: '从 DSH 模型选择器选择 Google Antigravity CLI，在当前工作区和 agy 对话。',
        refresh: '刷新', loading: '读取中…', updatedAt: '上次成功读取：{at}', saving: '正在保存…', saveSettings: '保存设置', savedSettings: '设置已保存。',
        status: '状态与额度', settings: '设置', toolActivity: '在对话中显示 agy 工具活动', toolActivityHint: '关闭后不显示工具进度行；权限询问和提示仍然显示。',
        version: '版本', login: '登录', signedIn: '已登录（额度读取成功）', signInRequired: '需要登录', unknown: '未确认',
        loginHelp: '请在终端运行 agy 或 agy acp --login，然后刷新。', process: 'ACP 进程', idle: '尚未启动（按需启动）', starting: '启动中', running: '运行中', stopped: '已退出（下次自动启动）',
        quota: '额度剩余', gemini: 'Gemini 模型', claudeGpt: 'Claude 和 GPT 模型', fiveHours: '5 小时', week: '每周', reset: '{at} 重置（本地时间）',
        models: '模型显示管理', modelHint: '勾选要出现在 DSH 模型选择器中的模型。隐藏不影响已使用该模型的会话，至少保留一个。',
        visibleCount: '已选 {shown}/{total}', selectAll: '全选（恢复默认）', discardModels: '撤销修改', saveModels: '保存模型显示', savedModels: '模型显示已保存。',
        low: '低', medium: '中', high: '高', xhigh: '极高', fixedEffort: '固定档位：{effort}',
        mode: 'agy 模式', modeChoose: '默认（由 CLI 决定）', modeHelp: '仅切换 agy 的原生模式。Auto 可能在不询问的情况下执行操作。',
        default: '默认', 'accept-edits': '接受编辑', auto: '自动（可能不询问）', plan: '计划',
        executable: 'agy 可执行文件路径', executableHint: '留空先探测 ~/.local/bin/agy，再尝试系统 PATH。当前使用：{file}',
        interject: '插话', interjectHelp: 'agy 回答过程中发送消息时：排队＝等本轮结束再发；并入＝送进当前回合，agy 做完手头的工具后处理；打断＝立刻取消当前回合再发（会中断正在执行的工具）。', interjectQueue: '排队', interjectSteer: '并入', interjectCancel: '打断', quotaLabel: '额度', quotaRefresh: '刷新额度', quotaFailed: '额度读取失败', quotaHour: '5小时', quotaWeek: '每周', quotaRemaining: '剩余 {percent}%',
      },
      en: {
        nav: 'Antigravity CLI', title: 'Antigravity CLI Bridge', intro: 'Select Google Antigravity CLI in the DSH model picker to use agy in the current workspace.',
        refresh: 'Refresh', loading: 'Loading…', updatedAt: 'Last successful update: {at}', saving: 'Saving…', saveSettings: 'Save settings', savedSettings: 'Settings saved.',
        status: 'Status and quota', settings: 'Settings', toolActivity: 'Show agy tool activity in chat', toolActivityHint: 'Hide tool progress lines without hiding permission questions or notices.',
        version: 'Version', login: 'Sign-in', signedIn: 'Signed in (quota available)', signInRequired: 'Sign-in required', unknown: 'Not confirmed',
        loginHelp: 'Run agy or agy acp --login in a terminal, then refresh.', process: 'ACP process', idle: 'Not started (starts on demand)', starting: 'Starting', running: 'Running', stopped: 'Stopped (restarts on demand)',
        quota: 'Remaining quota', gemini: 'Gemini models', claudeGpt: 'Claude and GPT models', fiveHours: '5 hours', week: 'Weekly', reset: 'Resets {at} (local time)',
        models: 'Model visibility', modelHint: 'Check the models you want in the DSH model picker. Hiding a model does not change existing sessions. Keep at least one visible.',
        visibleCount: '{shown} of {total} selected', selectAll: 'Select all (reset)', discardModels: 'Discard changes', saveModels: 'Save visibility', savedModels: 'Model visibility saved.',
        low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', fixedEffort: 'Fixed effort: {effort}',
        mode: 'agy mode', modeChoose: 'CLI default', modeHelp: 'Changes the native agy mode only. Auto may act without asking.',
        default: 'Default', 'accept-edits': 'Accept edits', auto: 'Auto (may not ask)', plan: 'Plan',
        executable: 'agy executable path', executableHint: 'Leave blank to try ~/.local/bin/agy first, then PATH. In use: {file}',
        interject: 'Interject', interjectHelp: 'When you send a message while agy is answering: Queue = send after the turn ends; Steer = join the running turn, agy handles it after its current tool; Cancel = cancel the turn now and send (interrupts a running tool).', interjectQueue: 'Queue', interjectSteer: 'Steer', interjectCancel: 'Cancel', quotaLabel: 'Quota', quotaRefresh: 'Refresh quota', quotaFailed: 'Could not read quota', quotaHour: '5h', quotaWeek: 'Weekly', quotaRemaining: '{percent}% left',
      },
    };
    const css = `
      .dagy { color: var(--dsw-alias-label-primary); display:grid; gap:14px; width:100%; max-width:760px; font-size:13px; }
      .dagy h2,.dagy h3,.dagy h4,.dagy p,.dagy dl { margin:0; }
      .dagy h2 { font-size:18px; }.dagy h3 { font-size:14px; }.dagy h4 { font-size:13px; }
      .dagy p,.dagy small,.dagy dt { color:var(--dsw-alias-label-tertiary); line-height:1.5; }
      .dagy .dagy-card { padding:14px; border-radius:12px; border:1px solid var(--dsw-alias-settings-card-stroke); background:var(--dsw-alias-settings-card-fill); display:grid; gap:9px; min-width:0; }
      .dagy .dagy-row { display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap; }
      .dagy .dagy-fields { display:flex; gap:12px 24px; flex-wrap:wrap; }.dagy dd {margin:2px 0 0; overflow-wrap:anywhere; }
      .dagy button,.dagy input[type=text],.dagy select { border:1px solid var(--dsw-alias-border-l3); border-radius:6px; padding:6px 10px; background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; max-width:100%; }
      .dagy input[type=text] { box-sizing:border-box; flex:1 1 210px; min-width:0; }
      .dagy input[type=checkbox] { accent-color:var(--dsw-alias-state-business-primary); flex:none; }
      .dagy button:enabled,.dagy input[type=checkbox]:enabled { cursor:pointer; }.dagy button:enabled:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .dagy button:disabled { color:var(--dsw-alias-label-tertiary); }.dagy :focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
      .dagy progress { width:100%; height:8px; border:0; border-radius:8px; overflow:hidden; appearance:none; background:var(--dsw-alias-bg-layer-1); }
      .dagy progress::-webkit-progress-bar { background:var(--dsw-alias-bg-layer-1); }
      .dagy progress::-webkit-progress-value { background:var(--dsw-alias-state-business-primary); }.dagy progress::-moz-progress-bar { background:var(--dsw-alias-state-business-primary); }
      .dagy .dagy-cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr)); gap:14px; }
      .dagy .dagy-period { display:grid; gap:4px; margin-top:9px; }.dagy .dagy-error { color:var(--dsw-alias-state-error-primary); overflow-wrap:anywhere; }
      .dagy .dagy-setting { display:grid; gap:5px; padding-block:10px 4px; border-top:1px solid var(--dsw-alias-settings-card-stroke); }
      .dagy .dagy-list { list-style:none; padding:0; margin:0; }
      .dagy .dagy-list label { display:flex; gap:8px; align-items:center; padding:7px 0; border-top:1px solid var(--dsw-alias-settings-card-stroke); }
      .dagy .dagy-list label span { flex:1; overflow-wrap:anywhere; }
    `;
    let rpc;
    async function request(route, { signal, body } = {}) {
      if (!rpc) throw new Error('DSH 连接尚未就绪。');
      const result = await rpc.call('/api', `${NS}.${route}`, body ?? {}, signal);
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      return result.value;
    }

    const resources = ['version', 'quota', 'models'];
    const starting = () => Object.fromEntries(resources.map(key => [key, { loading: true }]));
    let panelCache;
    function Panel({ t }) {
      const [data, setData] = React.useState(() => panelCache);
      const [feeds, setFeeds] = React.useState(starting);
      const [draft, setDraft] = React.useState({});
      const [modelDraft, setModelDraft] = React.useState(null);
      const [refreshNo, refresh] = React.useReducer(value => value + 1, 0);
      const [pending, setPending] = React.useState('');
      const [status, setStatus] = React.useState();
      const pathId = React.useId();
      const activeRead = React.useRef();
      React.useEffect(() => { if (data) panelCache = data; }, [data]);
      React.useEffect(() => {
        const controller = new AbortController();
        activeRead.current = controller;
        const { signal } = controller;
        setFeeds(starting());
        // The metadata endpoint reads only in-memory state. Once it settles,
        // each subprocess result is shown independently, with prior data intact.
        async function load() {
          try {
            const snapshot = await request('status', { signal });
            if (!signal.aborted) setData(snapshot);
          } catch (error) {
            if (!signal.aborted) setStatus({ error: error.message });
          }
          if (signal.aborted) return;
          for (const key of resources) {
            void request(key, { signal }).then(value => {
              if (signal.aborted) return;
              setData(data => ({ ...data, [key]: value }));
              setFeeds(feeds => ({ ...feeds, [key]: {} }));
            }, error => {
              if (!signal.aborted) setFeeds(feeds => ({ ...feeds, [key]: { error } }));
            });
          }
        }
        void load();
        return () => controller.abort();
      }, [refreshNo]);
      const settings = data?.settings;
      const executable = draft.executable ?? settings?.executable ?? '';
      const showToolActivity = draft.showToolActivity ?? settings?.showToolActivity ?? true;
      const settingsDirty = settings && (executable !== settings.executable || showToolActivity !== settings.showToolActivity);
      const models = data?.models?.value ?? [];
      const hidden = new Set(modelDraft ?? models.filter(model => !model.visible).map(model => model.id));
      const shown = models.filter(model => !hidden.has(model.id)).length;
      const modelsDirty = models.some(model => model.visible === hidden.has(model.id));

      function chooseModel(id, checked) {
        const next = new Set(hidden);
        if (checked) next.delete(id); else next.add(id);
        setModelDraft([...next]);
      }
      async function saveSettings(event) {
        event.preventDefault();
        setPending('settings');
        setStatus(undefined);
        try {
          const { settings: value } = await request('settings', { body: { executable, showToolActivity } });
          setDraft({});
          const pathChanged = value.executable !== settings.executable;
          if (pathChanged) activeRead.current?.abort();
          setData(current => ({ ...current, settings: value, ...(pathChanged ? { version: null, quota: null, models: null } : {}) }));
          setStatus({ target: 'settings', label: 'savedSettings' });
          if (pathChanged) {
            setModelDraft(null);
            refresh();
          }
        } catch (error) { setStatus({ target: 'settings', error: error.message }); }
        finally { setPending(''); }
      }
      async function saveVisibility(event) {
        event.preventDefault();
        setPending('models');
        setStatus(undefined);
        try {
          const { settings: value } = await request('settings', { body: { hiddenModels: models.filter(model => hidden.has(model.id)).map(model => model.id) } });
          setData(current => ({ ...current, settings: value, models: { ...current.models, value: (current.models?.value ?? models).map(model => ({
            ...model, visible: !value.hiddenModels.includes(model.id),
          })) } }));
          setModelDraft(null);
          setStatus({ target: 'models', label: 'savedModels' });
        } catch (error) { setStatus({ target: 'models', error: error.message }); }
        finally { setPending(''); }
      }
      const error = message => h('p', { className: 'dagy-error', role: 'alert' }, message);
      const notice = value => value?.error ? error(value.error) : value?.label ? h('p', { role: 'status' }, t(value.label)) : null;
      const rows = data?.quota?.value ?? [];
      const login = feeds.quota.error?.code === 'AUTH' ? 'signInRequired' : feeds.quota.error ? 'unknown' : rows.length ? 'signedIn' : 'unknown';
      const field = (label, text) => h('div', null, h('dt', null, t(label)), h('dd', null, text));
      const busy = !!pending;
      const feedNotice = key => h(React.Fragment, null,
        feeds[key].loading && h('p', { role: 'status' }, t('loading')),
        feeds[key].error && error(feeds[key].error.message),
        data?.[key]?.updatedAt && (key !== 'version' || feeds[key].error)
          ? h('small', null, t('updatedAt', { at: new Date(data[key].updatedAt).toLocaleString() })) : null);
      return h('section', { className: 'dagy' }, h('style', null, css),
        h('header', null, h('h2', null, t('title')), h('p', null, t('intro'))),
        !status?.target && notice(status),
        h('section', { className: 'dagy-card' },
          h('div', { className: 'dagy-row' }, h('h3', null, t('status')),
            h('button', { type: 'button', disabled: busy || resources.every(key => feeds[key].loading), onClick: () => { setStatus(undefined); refresh(); } }, t('refresh'))),
          h('dl', { className: 'dagy-fields' },
            field('version', h(React.Fragment, null, data?.version?.value ?? '—', feedNotice('version'))),
            field('login', feeds.quota.loading && !rows.length ? '—' : t(login)),
            field('process', data?.process ? t(data.process) : '—')),
          login === 'signInRequired' && h('p', null, t('loginHelp')),
          h('h4', null, t('quota')), feedNotice('quota'),
          !!rows.length && h('div', null, h('div', { className: 'dagy-cols' }, ['gemini', 'claudeGpt'].map(group => h('section', { key: group }, h('strong', null, t(group)),
            ...rows.filter(row => row.group === group).map(row => h('div', { className: 'dagy-period', key: row.period },
              h('div', { className: 'dagy-row' }, h('span', null, t(row.period)), h('strong', null, `${row.remaining}%`)),
              h('progress', { 'aria-label': `${t(row.group)} ${t(row.period)}`, value: row.remaining, max: 100 }),
              h('small', null, t('reset', { at: new Date(row.resetAt).toLocaleString() }))))))))),
        h('section', { className: 'dagy-card' }, h('h3', null, t('settings')),
          h('form', { className: 'dagy-setting', onSubmit: saveSettings },
            h('label', { htmlFor: pathId }, t('executable')),
            h('div', { className: 'dagy-row' }, h('input', { id: pathId, type: 'text', value: executable, placeholder: '~/.local/bin/agy', disabled: busy || !settings, onChange: event => setDraft(value => ({ ...value, executable: event.target.value })) })),
            h('p', null, t('executableHint', { file: data?.resolvedExecutable ?? '—' })),
            h('label', { className: 'dagy-row' }, t('toolActivity'), h('input', { type: 'checkbox', role: 'switch', checked: showToolActivity, 'aria-checked': showToolActivity,
              disabled: busy || !settings, onChange: event => setDraft(value => ({ ...value, showToolActivity: event.target.checked })) })),
            h('p', null, t('toolActivityHint')),
            h('div', { className: 'dagy-row' }, h('button', { type: 'submit', disabled: !settingsDirty || busy }, t(pending === 'settings' ? 'saving' : 'saveSettings'))),
            status?.target === 'settings' && notice(status))),
        h('form', { className: 'dagy-card', onSubmit: saveVisibility }, h('h3', null, t('models')), h('p', null, t('modelHint')),
          feedNotice('models'),
          !!models.length && h(React.Fragment, null,
            h('div', { className: 'dagy-row' }, h('p', { role: 'status' }, t('visibleCount', { shown, total: models.length })),
              h('button', { type: 'button', disabled: busy || shown === models.length, onClick: () => setModelDraft([]) }, t('selectAll'))),
            h('ul', { className: 'dagy-list' }, ...models.map(model => {
              const checked = !hidden.has(model.id);
              const levels = model.levels.length === 1 ? t('fixedEffort', { effort: t(model.levels[0]) }) : model.levels.map(level => t(level)).join(' / ');
              return h('li', { key: model.id }, h('label', null,
                h('input', { type: 'checkbox', checked, disabled: busy || checked && shown === 1, onChange: event => chooseModel(model.id, event.target.checked) }),
                h('span', null, model.name), levels && h('small', null, levels)));
            })),
            h('div', { className: 'dagy-row' },
              h('button', { type: 'submit', disabled: !modelsDirty || !shown || busy }, t(pending === 'models' ? 'saving' : 'saveModels')),
              h('button', { type: 'button', disabled: !modelsDirty || busy, onClick: () => setModelDraft(null) }, t('discardModels')))),
          status?.target === 'models' && notice(status)));
    }

    function ModeSelect({ t, sessionId, projection, running }) {
      const [mode, setMode] = React.useState();
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState();
      const [refreshNo, refresh] = React.useReducer(value => value + 1, 0);
      const reading = React.useRef();
      React.useEffect(() => {
        const controller = new AbortController();
        reading.current = controller;
        request('mode', { body: { sessionId }, signal: controller.signal }).then(
          value => { if (!controller.signal.aborted) { setMode(value); setError(undefined); } },
          cause => { if (!controller.signal.aborted) setError(cause.message); },
        );
        return () => controller.abort();
      }, [sessionId, projection, running, refreshNo]);
      if (!mode?.available) return projection === 'agy' && error ? h('span', { role: 'alert' }, error) : null;
      async function change(event) {
        const selected = event.target.value;
        reading.current?.abort();
        setSaving(true);
        setError(undefined);
        try { setMode(await request('mode', { body: { sessionId, mode: selected } })); }
        catch (cause) { setError(cause.message); }
        finally { setSaving(false); }
      }
      return h('div', { className: 'dagy-mode' },
        h('style', null, '.dagy-mode{display:flex;gap:4px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:12px}.dagy-mode select{max-width:135px;padding:2px 4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.dagy-mode select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}.dagy-mode [role=alert]{color:var(--dsw-alias-state-error-primary)}'),
        h('label', { title: t('modeHelp') }, 'agy ', h('select', { 'aria-label': t('mode'), value: mode.mode ?? '', disabled: saving, onFocus: refresh, onChange: change },
          h('option', { value: '', disabled: true }, t('modeChoose')), ...mode.modes.map(name => h('option', { key: name, value: name }, t(name))))),
        error && h('span', { role: 'alert', title: error }, error));
    }

    function ComposerMode({ t, sessionId, useSession, useProjection }) {
      const provider = useProjection('modelSelection', state => (state?.next ?? state?.lastUsed)?.provider);
      const running = useSession(state => state.running);
      const delegated = useSession(state => state.subagent != null);
      return !sessionId || delegated || provider && provider !== 'agy' ? null : h(ModeSelect, { key: sessionId, t, sessionId, projection: provider, running });
    }

    let quotaCache, quotaInflight;
    function loadQuota(force) {
      if (!force && quotaCache && Date.now() - quotaCache.at < 120000) return Promise.resolve(quotaCache);
      quotaInflight ??= request('quota').then(
        result => (quotaCache = { rows: result.value, at: Date.now() }),
      ).finally(() => { quotaInflight = undefined; });
      return quotaInflight;
    }
    const quotaCss = `
      .dagy-q { display:flex; align-items:center; gap:14px; flex-wrap:nowrap; overflow:hidden; white-space:nowrap; box-sizing:border-box; width:calc(100% - 2 * var(--dsh-composer-side-clearance, 16px)); max-width:var(--dsh-composer-card-max-width, 952px); margin:0 auto; padding:2px 14px; background:transparent; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:14px; }
      .dagy-q-head { display:flex; align-items:center; gap:4px; flex:none; color:var(--dsw-alias-label-tertiary); font-weight:600; }
      .dagy-q-group { display:flex; align-items:center; gap:8px; flex:none; transition:opacity .15s; }
      .dagy-q-group[data-dim] { opacity:.55; }
      .dagy-q-name { color:var(--dsw-alias-label-primary); font-weight:600; }
      .dagy-q-item { display:flex; align-items:center; gap:4px; }
      .dagy-q-track { width:36px; height:5px; border-radius:3px; overflow:hidden; background:var(--dsw-alias-bg-layer-3); }
      .dagy-q-fill { height:100%; border-radius:3px; transition:width .3s; }
      .dagy-q-num { min-width:26px; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary); }
      .dagy-q-btn { margin-left:auto; display:inline-grid; place-items:center; width:20px; height:20px; flex:none; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-tertiary); cursor:pointer; }
      .dagy-q-btn:hover:enabled { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .dagy-q-btn:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); }
      .dagy-q-btn[data-busy] svg { animation:dagy-spin 1s linear infinite; }
      .dagy-q-err { color:var(--dsw-alias-state-error-primary); }
      @keyframes dagy-spin { to { transform:rotate(360deg); } }
    `;
    const quotaColor = remaining => remaining < 10 ? 'var(--dsw-alias-state-error-primary)' : remaining < 30 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)';

    function QuotaStrip({ t, model, running }) {
      const [data, setData] = React.useState(() => quotaCache);
      const [error, setError] = React.useState();
      const [loading, setLoading] = React.useState(false);
      const wasRunning = React.useRef(running);
      const load = React.useCallback(force => {
        setLoading(true);
        loadQuota(force).then(
          value => { setData(value); setError(undefined); },
          cause => setError(cause.message),
        ).finally(() => setLoading(false));
      }, []);
      React.useEffect(() => { load(false); }, [load]);
      React.useEffect(() => {
        const finished = wasRunning.current && !running;
        wasRunning.current = running;
        if (!finished) return undefined;
        const timer = setTimeout(() => load(true), 1500);
        return () => clearTimeout(timer);
      }, [running, load]);
      const current = /gemini/i.test(model ?? '') ? 'gemini' : /claude|gpt|opus|sonnet/i.test(model ?? '') ? 'claudeGpt' : undefined;
      const rows = data?.rows ?? [];
      return h('div', { className: 'dagy-q', role: 'group', 'aria-label': t('quotaLabel') },
        h('style', null, quotaCss),
        h('span', { className: 'dagy-q-head' },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'M12 3v18M5 9l7-6 7 6M5 15l7 6 7-6' })), t('quotaLabel')),
        ['gemini', 'claudeGpt'].map(group => {
          const items = rows.filter(row => row.group === group);
          if (!items.length) return null;
          return h('div', { key: group, className: 'dagy-q-group', ...(current && current !== group ? { 'data-dim': '' } : {}) },
            h('span', { className: 'dagy-q-name' }, t(group === 'gemini' ? 'gemini' : 'claudeGpt').replace(/ ?(模型|models)$/i, '')),
            items.map(row => h('span', { key: row.period, className: 'dagy-q-item', title: `${t(row.period === 'week' ? 'week' : 'fiveHours')} · ${t('reset', { at: new Date(row.resetAt).toLocaleString() })}` },
              h('span', null, t(row.period === 'week' ? 'quotaWeek' : 'quotaHour')),
              h('span', { className: 'dagy-q-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': row.remaining, 'aria-label': `${t(group)} ${t(row.period)}` },
                h('span', { className: 'dagy-q-fill', style: { display: 'block', width: `${row.remaining}%`, background: quotaColor(row.remaining) } })),
              h('span', { className: 'dagy-q-num' }, `${row.remaining}%`))));
        }),
        error && h('span', { className: 'dagy-q-err', role: 'alert', title: error }, t('quotaFailed')),
        !rows.length && !error && loading && h('span', null, t('loading')),
        h('button', { type: 'button', className: 'dagy-q-btn', title: t('quotaRefresh'), 'aria-label': t('quotaRefresh'), disabled: loading, ...(loading ? { 'data-busy': '' } : {}), onClick: () => load(true) },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }))));
    }

    function QuotaDock({ t, sessionId, useSession, useProjection }) {
      const provider = useProjection('modelSelection', state => (state?.next ?? state?.lastUsed)?.provider);
      const model = useProjection('modelSelection', state => (state?.next ?? state?.lastUsed)?.model);
      const preset = useProjection('agentPreset', state => state);
      const running = useSession(state => state.running);
      const delegated = useSession(state => state.subagent != null);
      return !sessionId || delegated || provider !== 'agy' && preset !== 'agy' ? null : h(QuotaStrip, { t, model, running });
    }

    const interjectCache = new Map();
    function InterjectSelect({ t, sessionId, useSession, useProjection }) {
      const provider = useProjection('modelSelection', state => (state?.next ?? state?.lastUsed)?.provider);
      const preset = useProjection('agentPreset', state => state);
      const delegated = useSession(state => state.subagent != null);
      const [mode, setMode] = React.useState(() => interjectCache.get(sessionId) ?? 'queue');
      const [error, setError] = React.useState();
      const show = !!sessionId && !delegated && (provider === 'agy' || preset === 'agy');
      React.useEffect(() => {
        if (!show) return undefined;
        const controller = new AbortController();
        request('interject', { body: { sessionId }, signal: controller.signal }).then(
          value => { interjectCache.set(sessionId, value.mode); setMode(value.mode); },
          () => {},
        );
        return () => controller.abort();
      }, [show, sessionId]);
      if (!show) return null;
      async function change(event) {
        const next = event.target.value;
        const before = mode;
        setMode(next);
        setError(undefined);
        try {
          const value = await request('interject', { body: { sessionId, mode: next } });
          interjectCache.set(sessionId, value.mode);
          setMode(value.mode);
        } catch (cause) { setMode(before); setError(cause.message); }
      }
      return h('label', { className: 'dagy-interject', title: error ?? t('interjectHelp') },
        h('style', null, '.dagy-interject{display:flex;gap:4px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:12px}.dagy-interject select{max-width:90px;padding:2px 4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.dagy-interject select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}'),
        t('interject'), h('select', { 'aria-label': t('interject'), value: mode, onChange: change },
          ['queue', 'steer', 'cancel'].map(name => h('option', { key: name, value: name }, t(`interject${name[0].toUpperCase()}${name.slice(1)}`)))));
    }

    function SectionIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }), h('path', { d: 'm7 9 3 3-3 3m6 0h4' }));
    }

    return {
      inject: ['slots', 'locale', 'uiSession', 'connection'],
      apply(ctx) {
        rpc = ctx.connection.rpc;
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: NS, order: 60, locale: NS, label: () => t('nav'),
        }, Panel));
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: NS,
        }, SectionIcon));
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: `${NS}-mode`, order: 60, locale: NS,
        }, ComposerMode));
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: `${NS}-interject`, order: 61, locale: NS,
        }, InterjectSelect));
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: `${NS}-quota`, order: 30, locale: NS,
        }, QuotaDock));
      },
    };
  },
});
