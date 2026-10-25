/**
 * Ribbon item catalogue (id → icon/label) and the default ordering.
 */
export interface RibbonItemMeta {
  id: string
  label: string
  icon: string
}

export const RIBBON_META: Record<string, RibbonItemMeta> = {
  files: { id: 'files', label: '文件列表', icon: 'folder' },
  search: { id: 'search', label: '搜索', icon: 'search' },
  outline: { id: 'outline', label: '大纲', icon: 'list' },
  history: { id: 'history', label: '历史版本', icon: 'history' },
  tags: { id: 'tags', label: '标签', icon: 'tag' },
  graph: { id: 'graph', label: '关系图谱', icon: 'graph' },
  canvas: { id: 'canvas', label: '白板', icon: 'canvas' },
  calendar: { id: 'calendar', label: '日历', icon: 'calendar' },
  ai: { id: 'ai', label: 'AI 助手', icon: 'sparkles' },
  command: { id: 'command', label: '命令面板', icon: 'command' },
  plugins: { id: 'plugins', label: '插件中心', icon: 'puzzle' },
  account: { id: 'account', label: '个人中心', icon: 'user' },
  settings: { id: 'settings', label: '设置', icon: 'settings' }
}

export const ALL_RIBBON_ITEMS: RibbonItemMeta[] = Object.values(RIBBON_META)

export const DEFAULT_RIBBON_ITEMS = ['files', 'search', 'outline', 'tags', 'graph', 'canvas', 'calendar', 'ai', 'settings']
