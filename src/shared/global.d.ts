import type { TodoApi } from './contracts'
declare global { interface Window { todoApi: TodoApi } }
export {}
