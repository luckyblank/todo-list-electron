import type { TaskInput } from '../../shared/contracts'

/** Installed applications receive these editable tasks only when creating their first database. */
export const INITIAL_TASKS: ReadonlyArray<TaskInput & { completed: boolean }> = [
  {
    title: '创建你的第一个任务',
    description: '点击“新增任务”，记录今天要做的事。你可以填写描述、选择优先级，完成后点击左侧复选框。\n这是一条引导任务，可以自由编辑或删除。',
    priority: 1,
    completed: false
  },
  {
    title: '欢迎使用 To-Do List',
    description: '你的任务工作台已准备就绪。通过左侧菜单查看全部、未完成或已完成任务，也可以打开专注小窗随时查看。\n这条已完成的示例可以自由编辑或删除。',
    priority: 0,
    completed: true
  }
]
