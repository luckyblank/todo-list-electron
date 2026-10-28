export const channels = {
  list: 'tasks:list', create: 'tasks:create', update: 'tasks:update', complete: 'tasks:set-completed',
  remove: 'tasks:remove', restore: 'tasks:restore', reorder: 'tasks:reorder', preferences: 'settings:update',
  backupsList: 'backups:list', backupsCreate: 'backups:create', backupsRestore: 'backups:restore',
  windowState: 'window:get-state', minimize: 'window:minimize', maximize: 'window:toggle-maximize',
  requestClose: 'window:request-close', confirmClose: 'window:confirm-close', cancelClose: 'window:cancel-close',
  stateChanged: 'window:state-changed', closeRequested: 'window:close-requested', newTaskRequested: 'window:new-task-requested', tasksChanged: 'tasks:changed',
  miniOpen: 'mini:open', miniClose: 'mini:close', miniShowMain: 'mini:show-main', miniState: 'mini:get-state', miniPin: 'mini:set-pinned', miniChanged: 'mini:state-changed'
} as const
