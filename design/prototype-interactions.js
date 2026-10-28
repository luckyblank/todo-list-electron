(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const checkIcon = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const moreIcon = '<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg>';
  const seeds = [
    { id: 'demo-01', title: '梳理桌面应用需求', description: '整理任务管理、列表筛选与本地存储的核心流程。\n记录需要进一步确认的交互细节，作为下一阶段开发依据。', priority: 2, completed: false, createdAt: '2026-10-27T09:30:00+08:00', updatedAt: '2026-10-27T10:20:00+08:00', order: 0 },
    { id: 'demo-02', title: '整理首页交互方案', description: '确认任务列表与详情面板的布局，补充空状态和操作反馈。', priority: 2, completed: false, createdAt: '2026-10-27T09:10:00+08:00', updatedAt: '2026-10-27T09:10:00+08:00', order: 1 },
    { id: 'demo-03', title: '准备周会材料', description: '回顾本周进展，列出下周需要优先处理的事项。', priority: 1, completed: false, createdAt: '2026-10-26T16:20:00+08:00', updatedAt: '2026-10-26T16:20:00+08:00', order: 2 },
    { id: 'demo-04', title: '阅读产品设计资料', description: '留出半小时，整理可用于日常工具的设计细节。', priority: 0, completed: false, createdAt: '2026-10-26T10:00:00+08:00', updatedAt: '2026-10-26T10:00:00+08:00', order: 3 },
    { id: 'demo-05', title: '预约设备检修', description: '', priority: 1, completed: false, createdAt: '2026-10-25T14:30:00+08:00', updatedAt: '2026-10-25T14:30:00+08:00', order: 4 },
    { id: 'demo-06', title: '整理工作区文件', description: '将近期文档归档到对应目录，清理重复文件。', priority: 1, completed: true, createdAt: '2026-10-25T09:00:00+08:00', updatedAt: '2026-10-26T17:10:00+08:00', order: 5 },
    { id: 'demo-07', title: '完成上周复盘', description: '记录有效的方法，以及需要调整的安排。', priority: 0, completed: true, createdAt: '2026-10-24T15:00:00+08:00', updatedAt: '2026-10-25T11:00:00+08:00', order: 6 },
    { id: 'demo-08', title: '更新项目文档', description: '补充产品需求、技术架构与验收标准。', priority: 1, completed: true, createdAt: '2026-10-23T10:00:00+08:00', updatedAt: '2026-10-24T16:30:00+08:00', order: 7 }
  ];
  const state = {
    tasks: clone(seeds), filter: 'all', query: '', sort: 'newest', selected: null,
    panelOpen: false, creating: false, original: '', saving: false, scenario: 'default',
    pending: null, menu: null, menuAnchor: null, returnControl: 'add-task', toasts: [], searchTimer: null
  };
  const priorities = { 2: ['高优先级', 'high'], 1: ['普通', 'normal'], 0: ['低优先级', 'low'] };
  const filterTitles = { all: '全部任务', active: '未完成', completed: '已完成' };
  const normalize = (value) => value.normalize('NFKC').trim().toLowerCase();
  const canReorder = () => state.sort === 'manual' && state.filter === 'all' && !state.query;
  const draft = () => ({ title: $('title-input').value, description: $('description-input').value, priority: Number($('priority-input').value) });
  const isDirty = () => state.panelOpen && JSON.stringify(draft()) !== state.original;
  const dateLabel = (value, full = false) => new Intl.DateTimeFormat('zh-CN', full
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit' }).format(new Date(value));

  function visibleTasks() {
    return state.tasks.filter((task) => (state.filter === 'all' || (state.filter === 'completed') === task.completed)
      && (!state.query || normalize(`${task.title}\n${task.description}`).includes(state.query)))
      .sort((a, b) => {
        const byDate = new Date(b.createdAt) - new Date(a.createdAt);
        const result = state.sort === 'oldest' ? -byDate : state.sort === 'priority'
          ? b.priority - a.priority || byDate : state.sort === 'manual' ? a.order - b.order : byDate;
        return result || a.id.localeCompare(b.id);
      });
  }

  function stateMarkup(type) {
    const data = {
      empty: ['从第一件小事开始', '把需要做的事情记下来，为重要的事留出注意力。', '新增任务', 'add'],
      filtered: [state.filter === 'completed' ? '还没有已完成的任务' : '目前没有未完成的任务', '切换任务视图，或记录接下来要做的事。', '查看全部任务', 'all'],
      search: ['没有找到匹配的任务', `试试其他关键词，或清除“${$('search-input').value}”。`, '清除搜索', 'clear'],
      loading: ['正在加载任务', '这是加载状态演示，可随时返回任务列表。', '返回任务列表', 'reset'],
      error: ['暂时无法读取任务', '任务内容没有被清空，请重试以返回演示列表。', '重新加载', 'reset']
    }[type];
    return `<div class="list-state ${type === 'loading' ? 'is-loading' : ''}" role="status">
      <div class="state-icon" aria-hidden="true">${type === 'error' ? '!' : type === 'loading' ? '·' : checkIcon}</div>
      <h3 class="state-title">${escape(data[0])}</h3><p class="state-description">${escape(data[1])}</p>
      <button type="button" class="state-action" data-state-action="${data[3]}">${data[2]}</button></div>`;
  }

  function render() {
    const focused = document.activeElement;
    const focusedRow = focused?.closest('.task-row');
    const focusedTask = focusedRow?.dataset.id;
    const focusedControl = focused?.classList.contains('task-check') ? '.task-check'
      : focused?.classList.contains('task-menu-button') ? '.task-menu-button' : null;
    const completed = state.tasks.filter((task) => task.completed).length;
    $('count-all').textContent = state.tasks.length;
    $('count-active').textContent = state.tasks.length - completed;
    $('count-completed').textContent = completed;
    document.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle('is-active', active);
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('view-title').textContent = filterTitles[state.filter];
    const tasks = visibleTasks();
    $('view-subtitle').textContent = state.scenario === 'loading' ? '正在读取演示任务' : state.scenario === 'error'
      ? '读取状态演示' : state.query ? `找到 ${tasks.length} 项匹配任务` : state.filter === 'all'
        ? `共 ${tasks.length} 项任务 · ${state.tasks.length - completed} 项未完成` : `共 ${tasks.length} 项${state.filter === 'completed' ? '已完成' : '未完成'}任务`;
    $('clear-search').hidden = !$('search-input').value;
    $('drag-hint').hidden = state.sort !== 'manual';
    $('drag-hint').textContent = canReorder() ? '可通过任务菜单上移或下移，调整任务顺序' : '切换到全部任务并清除搜索后，可手动调整顺序';
    const blocked = ['loading', 'error'].includes(state.scenario);
    $('add-task').disabled = blocked;
    $('quick-add').disabled = blocked;
    $('task-list').setAttribute('aria-busy', String(state.scenario === 'loading'));
    if (blocked) $('task-list').innerHTML = stateMarkup(state.scenario);
    else if (!tasks.length) $('task-list').innerHTML = stateMarkup(state.query ? 'search' : !state.tasks.length ? 'empty' : 'filtered');
    else $('task-list').innerHTML = tasks.map((task) => {
      const [priority, priorityClass] = priorities[task.priority];
      return `<article class="task-row${task.completed ? ' is-completed completed' : ''}${task.id === state.selected ? ' is-selected selected' : ''}" data-id="${escape(task.id)}" tabindex="0" aria-label="查看任务：${escape(task.title)}">
        <button class="task-check${task.completed ? ' checked' : ''}" type="button" role="checkbox" aria-checked="${task.completed}" aria-label="${task.completed ? '标记为未完成' : '标记为已完成'}：${escape(task.title)}">${task.completed ? checkIcon : ''}</button>
        <div class="task-copy"><div class="task-title">${escape(task.title)}</div>${task.description ? `<div class="task-description">${escape(task.description.replace(/\n/g, ' '))}</div>` : ''}
        <div class="task-meta"><span>${task.completed ? '已完成' : '未完成'}</span><span class="meta-separator">·</span><span>${dateLabel(task.createdAt)} 创建</span></div></div>
        <span class="priority-tag ${priorityClass}">${priority}</span><button class="task-menu-button" type="button" aria-label="更多操作：${escape(task.title)}" aria-haspopup="menu">${moreIcon}</button></article>`;
    }).join('');
    if (focusedTask) {
      const replacement = findRow(focusedTask);
      (replacement && focusedControl ? replacement.querySelector(focusedControl) : replacement || $('add-task'))?.focus();
    }
  }

  function findRow(id) {
    return Array.from($('task-list').querySelectorAll('.task-row')).find((row) => row.dataset.id === id);
  }

  function setFormError(message = '') {
    $('form-error').textContent = message;
    $('form-error').hidden = !message;
  }

  function syncPanel(open) {
    state.panelOpen = open;
    $('detail-panel').classList.toggle('is-open', open);
    $('detail-panel').setAttribute('aria-hidden', String(!open));
    $('detail-panel').inert = !open;
    document.body.classList.toggle('detail-open', open);
    if ($('toggle-detail')) $('toggle-detail').checked = open;
  }

  function updateDraftState() {
    $('title-count').textContent = `${Array.from($('title-input').value).length} / 120`;
    $('save-task').disabled = state.saving || !isDirty() || !$('title-input').value.trim();
    $('save-task').textContent = state.saving ? '保存中…' : state.creating ? '创建任务' : '保存修改';
    $('task-form').setAttribute('aria-busy', String(state.saving));
  }

  function fillForm(task) {
    if (!task) state.returnControl = ['add-task', 'quick-add'].includes(document.activeElement?.id)
      ? document.activeElement.id : 'add-task';
    state.selected = task ? task.id : null;
    state.creating = !task;
    $('detail-title').textContent = task ? '任务详情' : '新增任务';
    $('title-input').value = task?.title || '';
    $('description-input').value = task?.description || '';
    $('priority-input').value = task ? String(task.priority) : '1';
    $('task-created').textContent = task ? dateLabel(task.createdAt, true) : '创建后自动记录';
    $('task-updated').textContent = task ? dateLabel(task.updatedAt, true) : '尚未保存';
    $('delete-task').hidden = !task;
    setFormError();
    state.original = JSON.stringify(draft());
    syncPanel(true);
    updateDraftState();
    render();
  }

  function openTask(id, focus = true) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    fillForm(task);
    if (focus) $('title-input').focus();
  }

  function closePanel() {
    const returnTask = state.selected;
    syncPanel(false);
    state.selected = null;
    state.creating = false;
    render();
    (findRow(returnTask) || $(state.returnControl) || $('add-task')).focus();
  }

  function requestAction(action) {
    closeMenu();
    if (state.saving) return;
    if (!isDirty()) { action(); return; }
    state.pending = action;
    const dialog = $('discard-dialog');
    if (dialog?.showModal) dialog.showModal();
    else if (window.confirm('存在未保存的修改。是否放弃修改并继续？')) { state.pending = null; action(); }
    else state.pending = null;
  }

  function saveTask(afterSave) {
    if (state.saving) return;
    if (!isDirty()) { if (typeof afterSave === 'function') afterSave(); return; }
    const value = draft();
    value.title = value.title.trim();
    value.description = value.description.replace(/\r\n?/g, '\n');
    const length = Array.from(value.title).length;
    const invalid = !length ? '请输入任务标题。' : length > 120 ? '任务标题不能超过 120 个字符。'
      : Array.from(value.description).length > 2000 ? '描述不能超过 2,000 个字符。'
        : /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(`${value.title}${value.description}`) ? '内容包含不支持的控制字符。' : '';
    if (invalid) { setFormError(invalid); $('title-input').focus(); return; }
    setFormError();
    state.saving = true;
    updateDraftState();
    window.setTimeout(() => {
      const wasCreating = state.creating;
      let task = state.tasks.find((item) => item.id === state.selected);
      const now = new Date().toISOString();
      if (wasCreating) {
        task = { id: `demo-${crypto.randomUUID()}`, ...value, completed: false, createdAt: now, updatedAt: now,
          order: Math.max(-1, ...state.tasks.map((item) => item.order)) + 1 };
        state.tasks.push(task);
      } else if (task) Object.assign(task, value, { updatedAt: now });
      state.saving = false;
      if (!task) { setFormError('这项任务已不存在，请重新选择。'); updateDraftState(); return; }
      state.scenario = 'default';
      state.original = JSON.stringify(draft());
      if (wasCreating) closePanel(); else fillForm(task);
      const visible = visibleTasks().some((item) => item.id === task.id);
      notify(wasCreating ? '任务已创建' : '修改已保存', visible ? '已更新当前演示内容' : '当前筛选下不可见', visible ? null : {
        label: '查看任务', run: () => requestAction(() => {
          state.filter = 'all'; state.query = ''; $('search-input').value = ''; openTask(task.id);
        })
      });
      render();
      if (typeof afterSave === 'function') afterSave();
    }, 180);
  }

  function notify(title, subtitle = '', action = null, lifetime = 3200) {
    while (state.toasts.length >= 3) removeToast(state.toasts[0]);
    const node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.innerHTML = `<span class="toast-mark" aria-hidden="true">${checkIcon}</span><div class="toast-content"><div class="toast-title">${escape(title)}</div><div class="toast-subtitle">${escape(subtitle)}</div></div>`;
    const toast = { node, timeout: null, interval: null };
    if (action) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'toast-action'; button.textContent = action.label;
      button.addEventListener('click', () => { removeToast(toast); action.run(); });
      node.append(button);
      if (action.deadline) toast.interval = setInterval(() => {
        const seconds = Math.max(0, Math.ceil((action.deadline - Date.now()) / 1000));
        button.textContent = `${action.label} ${seconds}s`;
      }, 250);
    }
    $('toast-region').append(node);
    state.toasts.push(toast);
    toast.timeout = setTimeout(() => removeToast(toast), lifetime);
  }

  function removeToast(toast) {
    clearTimeout(toast.timeout); clearInterval(toast.interval);
    toast.node.remove(); state.toasts = state.toasts.filter((item) => item !== toast);
  }

  function deleteTask(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    const deleted = clone(task);
    state.tasks = state.tasks.filter((item) => item.id !== id);
    if (state.selected === id) closePanel();
    render();
    const deadline = Date.now() + 8000;
    notify('任务已删除', task.title, { label: '撤销', deadline, run: () => {
      if (Date.now() > deadline) { notify('撤销时间已过', '可通过新增任务重新记录。'); return; }
      deleted.updatedAt = new Date().toISOString();
      state.tasks.push(deleted); render(); notify('任务已恢复', deleted.title);
    } }, 8000);
  }

  function toggleTask(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    const change = () => {
      task.completed = !task.completed; task.updatedAt = new Date().toISOString();
      if (state.selected === id) fillForm(task);
      render(); notify(task.completed ? '任务已完成' : '已恢复为未完成', task.title);
    };
    if (state.selected === id && isDirty()) requestAction(change); else change();
  }

  function closeMenu(restoreFocus = true) {
    if (!state.menu) return;
    const anchor = state.menuAnchor;
    state.menu.remove(); state.menu = null; state.menuAnchor = null;
    anchor?.node.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (findRow(anchor?.id)?.querySelector('.task-menu-button') || $('add-task')).focus();
  }

  function moveTask(id, offset) {
    if (!canReorder()) return;
    const ordered = visibleTasks();
    const index = ordered.findIndex((item) => item.id === id);
    const next = index + offset;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    ordered.forEach((task, order) => { task.order = order; });
    render(); notify(offset < 0 ? '任务已上移' : '任务已下移', '手动顺序已更新');
  }

  function openMenu(id, anchor) {
    closeMenu(false);
    const menu = document.createElement('div');
    menu.className = 'task-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = '<button class="menu-item" type="button" role="menuitem" data-action="edit">编辑任务</button>'
      + (canReorder() ? '<button class="menu-item" type="button" role="menuitem" data-action="up">上移</button><button class="menu-item" type="button" role="menuitem" data-action="down">下移</button>' : '')
      + '<button class="menu-item is-danger" type="button" role="menuitem" data-action="delete">删除任务</button>';
    document.body.append(menu); state.menu = menu; state.menuAnchor = { id, node: anchor };
    anchor.setAttribute('aria-expanded', 'true');
    const bounds = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(bounds.right - 160, window.innerWidth - 172))}px`;
    menu.style.top = `${Math.min(bounds.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
    if (canReorder()) {
      const ordered = visibleTasks(); const index = ordered.findIndex((task) => task.id === id);
      menu.querySelector('[data-action="up"]').disabled = index === 0;
      menu.querySelector('[data-action="down"]').disabled = index === ordered.length - 1;
    }
    menu.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      closeMenu();
      if (action === 'edit') requestAction(() => openTask(id));
      if (action === 'delete') requestAction(() => deleteTask(id));
      if (action === 'up') moveTask(id, -1);
      if (action === 'down') moveTask(id, 1);
    });
    menu.addEventListener('keydown', (event) => {
      const items = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      if (event.key === 'Tab') closeMenu();
    });
    menu.querySelector('button').focus();
  }

  function resetDemo() {
    closeMenu(); state.toasts.slice().forEach(removeToast);
    state.tasks = clone(seeds); state.filter = 'all'; state.query = ''; state.sort = 'newest'; state.scenario = 'default';
    $('search-input').value = ''; $('sort-select').value = 'newest'; $('scenario-select').value = 'default';
    openTask(seeds[0].id, false);
    if (document.querySelector('.desktop-window').clientWidth < 1200) closePanel();
    render();
  }

  function setScenario(value) {
    if (value === 'default' || value === 'reset') { resetDemo(); return; }
    state.scenario = value; closePanel();
    if (value === 'empty') { state.tasks = []; state.query = ''; $('search-input').value = ''; state.filter = 'all'; }
    if (value === 'no-results') {
      state.tasks = clone(seeds); state.filter = 'all'; $('search-input').value = '明年的旅行计划'; state.query = normalize($('search-input').value);
    }
    render();
  }

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter; closeMenu(); render();
  }));
  $('task-list').addEventListener('click', (event) => {
    const stateAction = event.target.closest('[data-state-action]')?.dataset.stateAction;
    if (stateAction === 'add') requestAction(() => { fillForm(null); $('title-input').focus(); });
    if (stateAction === 'reset') requestAction(resetDemo);
    if (stateAction === 'all') { state.filter = 'all'; render(); }
    if (stateAction === 'clear') { state.query = ''; $('search-input').value = ''; render(); $('search-input').focus(); }
    const row = event.target.closest('.task-row');
    if (!row) return;
    if (event.target.closest('.task-check')) { toggleTask(row.dataset.id); return; }
    const menuButton = event.target.closest('.task-menu-button');
    if (menuButton) { openMenu(row.dataset.id, menuButton); return; }
    requestAction(() => openTask(row.dataset.id));
  });
  $('task-list').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('.task-row')) { event.preventDefault(); requestAction(() => openTask(event.target.dataset.id)); }
  });
  const search = () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => { state.query = normalize($('search-input').value); render(); }, 150);
  };
  $('search-input').addEventListener('input', (event) => { if (!event.isComposing) search(); });
  $('search-input').addEventListener('compositionend', search);
  $('clear-search').addEventListener('click', () => { clearTimeout(state.searchTimer); state.query = ''; $('search-input').value = ''; render(); $('search-input').focus(); });
  $('sort-select').addEventListener('change', () => { state.sort = $('sort-select').value; closeMenu(); render(); });
  ['add-task', 'quick-add'].forEach((id) => $(id).addEventListener('click', () => requestAction(() => { fillForm(null); $('title-input').focus(); })));
  ['close-detail', 'cancel-edit'].forEach((id) => $(id).addEventListener('click', () => requestAction(closePanel)));
  $('task-form').addEventListener('submit', (event) => { event.preventDefault(); saveTask(); });
  ['title-input', 'description-input', 'priority-input'].forEach((id) => {
    $(id).addEventListener('input', updateDraftState); $(id).addEventListener('change', updateDraftState);
  });
  $('delete-task').addEventListener('click', () => requestAction(() => deleteTask(state.selected)));
  if ($('discard-dialog')) {
    $('discard-save').addEventListener('click', () => {
      const action = state.pending; state.pending = null; $('discard-dialog').close(); saveTask(action);
    });
    $('discard-drop').addEventListener('click', () => {
      const action = state.pending; state.pending = null; $('discard-dialog').close(); if (action) action();
    });
    $('discard-cancel').addEventListener('click', () => { state.pending = null; $('discard-dialog').close(); });
    $('discard-dialog').addEventListener('cancel', () => { state.pending = null; });
  }
  function setTweaks(open) {
    $('tweaks-panel').hidden = !open;
    $('tweaks-toggle').setAttribute('aria-expanded', String(open));
  }
  $('tweaks-toggle').addEventListener('click', () => setTweaks($('tweaks-panel').hidden));
  $('close-tweaks').addEventListener('click', () => { setTweaks(false); $('tweaks-toggle').focus(); });
  $('density-select').addEventListener('change', () => { document.body.dataset.density = $('density-select').value; });
  $('scenario-select').addEventListener('change', () => requestAction(() => setScenario($('scenario-select').value)));
  $('toggle-detail').addEventListener('change', () => {
    if ($('toggle-detail').checked) requestAction(() => openTask(visibleTasks()[0]?.id || state.tasks[0]?.id));
    else requestAction(closePanel);
    $('toggle-detail').checked = state.panelOpen;
  });
  $('reset-demo').addEventListener('click', () => requestAction(resetDemo));
  document.addEventListener('click', (event) => { if (state.menu && !event.target.closest('.task-menu, .task-menu-button')) closeMenu(false); });
  window.addEventListener('resize', () => closeMenu());
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); if (!$('add-task').disabled) $('add-task').click(); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); $('search-input').focus(); $('search-input').select(); }
      if (event.key === 'Enter' && state.panelOpen && !$('discard-dialog')?.open) { event.preventDefault(); saveTask(); }
    }
    if (event.key === 'Escape' && !$('discard-dialog')?.open) {
      if (state.menu) closeMenu();
      else if (!$('tweaks-panel').hidden) { setTweaks(false); $('tweaks-toggle').focus(); }
      else if (state.panelOpen) requestAction(closePanel);
    }
  });
  window.todoPrototype = { reset: resetDemo, snapshot: () => clone({ tasks: state.tasks, filter: state.filter, sort: state.sort, scenario: state.scenario }) };
  setTweaks(!$('tweaks-panel').hidden);
  resetDemo();
})();
