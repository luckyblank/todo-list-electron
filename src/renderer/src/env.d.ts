/// <reference types="vite/client" />
import type { TodoApi } from '@shared/contracts'

declare global {
  interface Window { todoApi: TodoApi }
}
