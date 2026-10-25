/**
 * Conflict merge dialog — shown when a save is rejected with 409 CONFLICT.
 * Side-by-side local/remote diff plus three resolutions.
 */
import React, { useState } from 'react'
import { registerModal } from '@/components/Overlays'
import { useStore } from '@/store'
import { Icon } from '@/components/Icon'
import { DiffView } from '@/features/history/DiffView'
import { formatTime } from '@/features/files/fileUtils'
import {
  resolveConflictKeepLocal,
  resolveConflictKeepRemote,
  resolveConflictSaveCopy
} from './docRepo'

const ConflictModal: React.FC<{ props?: Record<string, unknown>; onClose: () => void }> = ({ onClose }) => {
  const conflict = useStore((s) => s.conflict)
  const [busy, setBusy] = useState<'local' | 'copy' | null>(null)

  if (!conflict) {
    onClose()
    return null
  }

  const keepLocal = async () => {
    setBusy('local')
    try {
      const ok = await resolveConflictKeepLocal()
      if (ok) onClose()
    } finally {
      setBusy(null)
    }
  }
  const keepRemote = () => {
    resolveConflictKeepRemote()
    onClose()
  }
  const saveCopy = async () => {
    setBusy('copy')
    try {
      const p = await resolveConflictSaveCopy()
      if (p) onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <Icon name="alert" size={17} />
        <h3 className="grow ellipsis">文件已被修改</h3>
        <button className="btn-icon" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="tip-line">
          <Icon name="info" size={13} />
          <span>
            「{conflict.path.split('/').pop()}」在 {formatTime(conflict.remoteMtime)} 被 {conflict.device || '其他设备'} 修改，
            请选择要保留的版本。
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 280, display: 'flex' }}>
          <DiffView left={conflict.localContent} right={conflict.remoteContent} leftLabel="本地（当前编辑）" rightLabel="远端（已保存）" />
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={keepRemote}>保留远端</button>
        <button className="btn" disabled={busy === 'copy'} onClick={saveCopy}>
          {busy === 'copy' ? '保存中…' : '另存为冲突副本'}
        </button>
        <button className="btn btn-primary" disabled={busy === 'local'} onClick={keepLocal}>
          {busy === 'local' ? '保存中…' : '保留本地并覆盖'}
        </button>
      </div>
    </div>
  )
}

let registered = false
export const registerConflictDialog = () => {
  if (registered) return
  registered = true
  registerModal('editor.conflict', ConflictModal)
}

/** Open the merge dialog (used when the store reports a conflict). */
export const openConflictDialog = () => {
  registerConflictDialog()
  useStore.getState().openModal('editor.conflict')
}

export default ConflictModal
