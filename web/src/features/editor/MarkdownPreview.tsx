/**
 * Read-only markdown preview used by the "preview" view mode, split side pane
 * and the welcome page document card.
 */
import React, { useEffect, useMemo, useRef } from 'react'
import { enhanceDom, renderMarkdown } from './mdRenderer'

interface Props {
  markdown: string
  className?: string
  /** heading anchor click → callback (used by outline jumps) */
  onHeadingClick?: (text: string, level: number) => void
  scrollTop?: number
  onScroll?: (top: number) => void
}

export const MarkdownPreview: React.FC<Props> = ({ markdown, className = '', scrollTop, onScroll }) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(markdown), [markdown])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    enhanceDom(el)
  }, [html])

  useEffect(() => {
    if (scrollTop != null && scrollRef.current) scrollRef.current.scrollTop = scrollTop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={'md-preview ' + className}
      ref={scrollRef}
      onScroll={(e) => onScroll?.((e.target as HTMLDivElement).scrollTop)}
    >
      <div className="md-preview-inner">
        <div className="md-prose" ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

export default MarkdownPreview
