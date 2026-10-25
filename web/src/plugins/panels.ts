/**
 * Lazy component registry. Importing this file schedules ~25 dynamic imports
 * but loads none of them until a plugin panel is actually rendered — the first
 * paint never pays for the 24 built-in panels.
 */
import { lazy, type LazyExoticComponent } from 'react'
import type { PanelComponent } from './types'

type Lazy = LazyExoticComponent<PanelComponent>

export const PANELS: Record<string, Lazy> = {
  canvas: lazy(() => import('./items/canvas')),
  'note-restructure': lazy(() => import('./items/note-restructure')),
  'tag-list': lazy(() => import('./items/tag-list')),
  'outgoing-links': lazy(() => import('./items/outgoing-links')),
  outline: lazy(() => import('./items/outline')),
  publish: lazy(() => import('./items/publish')),
  backlinks: lazy(() => import('./items/backlinks')),
  workspace: lazy(() => import('./items/workspace')),
  graph: lazy(() => import('./items/graph')),
  slides: lazy(() => import('./items/slides')),
  'footnote-view': lazy(() => import('./items/footnote-view')),
  'quick-switcher': lazy(() => import('./items/quick-switcher')),
  recorder: lazy(() => import('./items/recorder')),
  'random-note': lazy(() => import('./items/random-note')),
  'daily-notes': lazy(() => import('./items/daily-notes')),
  bookmarks: lazy(() => import('./items/bookmarks')),
  properties: lazy(() => import('./items/properties')),
  database: lazy(() => import('./items/database')),
  'web-browser': lazy(() => import('./items/web-browser')),
  'file-recovery': lazy(() => import('./items/file-recovery')),
  'file-explorer': lazy(() => import('./items/file-explorer')),
  'slash-commands': lazy(() => import('./items/slash-commands')),
  'page-preview': lazy(() => import('./items/page-preview')),
  'word-count': lazy(() => import('./items/word-count')),
  ai: lazy(() => import('./items/ai'))
}

/** Status-bar contribution (must stay cheap — it renders on every save). */
export const STATUS_PANELS: Record<string, Lazy> = {
  'word-count': lazy(() => import('./items/word-count-status'))
}

export const panelOf = (id: string): Lazy | undefined => PANELS[id]
