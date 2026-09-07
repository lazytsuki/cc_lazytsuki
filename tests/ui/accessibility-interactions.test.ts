import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { nextMenuItemIndex } from '@/src/components/thoughts/thought-menu'

describe('workspace interaction accessibility', () => {
  it('gives every modal a stable accessible name and description', async () => {
    const importDialog = await readFile('src/components/thoughts/import-text-dialog.tsx', 'utf8')
    const checkpointDialog = await readFile('src/components/thoughts/checkpoint-dialog.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')

    expect(importDialog).toContain('aria-labelledby={importDialogTitleId}')
    expect(importDialog).toContain('aria-describedby={importDialogDescriptionId}')
    expect(importDialog).toContain('id={importDialogTitleId}')
    expect(importDialog).toContain('id={importDialogDescriptionId}')
    expect(checkpointDialog).toContain('aria-labelledby="checkpoint-dialog-title"')
    expect(checkpointDialog).toContain('aria-describedby="checkpoint-dialog-description"')
    expect(navigation).toContain('aria-labelledby="delete-thought-dialog-title"')
    expect(navigation).toContain('aria-describedby="delete-thought-dialog-description"')
    expect(navigation).toContain('aria-labelledby="delete-collection-dialog-title"')
    expect(navigation).toContain('aria-describedby="delete-collection-dialog-description"')
  })

  it('keeps file selection reachable from the keyboard', async () => {
    const importDialog = await readFile('src/components/thoughts/import-text-dialog.tsx', 'utf8')

    expect(importDialog).toContain('htmlFor={importFileInputId}')
    expect(importDialog).toContain('id={importFileInputId}')
    expect(importDialog).toContain('className="visually-hidden-file-input"')
    expect(importDialog).not.toMatch(/<label className="file-button">[\s\S]*?<input/)
  })

  it('implements complete keyboard semantics for the thought menu', async () => {
    const menu = await readFile('src/components/thoughts/thought-menu.tsx', 'utf8')
    const exports = await readFile('src/components/thoughts/export-menu.tsx', 'utf8')
    const actionMenu = await readFile('src/components/thoughts/thought-action-menu.tsx', 'utf8')

    expect(menu).toContain('aria-controls={menuOpen ? \'thought-menu-panel\' : undefined}')
    expect(menu).toContain('aria-labelledby="thought-menu-trigger"')
    expect(menu.match(/role="menuitem"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(exports.match(/role="menuitem"/g)).toHaveLength(3)
    expect(exports).toContain("'导出当前想法为 Markdown' : '导出当前页面快照为 Markdown'")
    expect(exports).toContain('aria-label="导出云端全部想法为 JSON"')
    expect(exports).toContain('aria-label="下载本机草稿和未同步内容为 JSON"')
    expect(exports).toContain("verifyExportOwner(userId, kind !== 'cloud')")
    expect(exports).toContain('frame.src = downloadUrl.toString()')
    expect(exports).not.toContain('response.blob()')
    expect(menu).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']")
    expect(menu).toContain("event.key === 'Escape'")
    expect(menu).toContain("event.key === 'Tab'")
    expect(menu).toContain('focusOutsideMenu(event.shiftKey)')
    expect(menu).toContain("?.focus({ preventScroll: true })")
    expect(menu).toContain('onKeyDown={navigateMenu}')
    expect(actionMenu).toContain('aria-label={`想法操作：${actionLabel}`}')
  })

  it('moves through menu items and wraps at both ends', () => {
    expect(nextMenuItemIndex('ArrowDown', 0, 4)).toBe(1)
    expect(nextMenuItemIndex('ArrowDown', 3, 4)).toBe(0)
    expect(nextMenuItemIndex('ArrowUp', 0, 4)).toBe(3)
    expect(nextMenuItemIndex('ArrowUp', 2, 4)).toBe(1)
    expect(nextMenuItemIndex('Home', 3, 4)).toBe(0)
    expect(nextMenuItemIndex('End', 0, 4)).toBe(3)
    expect(nextMenuItemIndex('ArrowDown', -1, 4)).toBe(0)
    expect(nextMenuItemIndex('ArrowUp', -1, 4)).toBe(3)
    expect(nextMenuItemIndex('ArrowDown', 0, 0)).toBeNull()
  })

  it('keeps pending writes visible until they settle and restores focus after destructive changes', async () => {
    const importDialog = await readFile('src/components/thoughts/import-text-dialog.tsx', 'utf8')
    const checkpointDialog = await readFile('src/components/thoughts/checkpoint-dialog.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')

    expect(importDialog).not.toContain('AbortController')
    expect(importDialog).toContain('if (savingRef.current) return')
    expect(importDialog).toContain("saving ? '正在导入，暂时无法关闭'")
    expect(importDialog).toContain('requestIdsRef.current ?? nextRequestIds()')
    expect(checkpointDialog).not.toContain('AbortController')
    expect(checkpointDialog).toContain('if (savingRef.current) return')
    expect(checkpointDialog).toContain("saving ? '正在保存，暂时无法关闭'")
    expect(navigation).toContain('function thoughtFocusTarget(')
    expect(navigation).toContain('function collectionFocusTarget(')
    expect(navigation).toContain('function focusAfterMutation(')
    expect(navigation).not.toContain('AbortController')
    expect(navigation).not.toContain('signal: AbortSignal.timeout(20_000)')
    expect(navigation).toContain("deletingThought ? '关闭' : '取消'")
    expect(navigation).toContain("deletingCollection ? '关闭' : '取消'")
    expect(workspace).toContain('if (importPendingRef.current)')
    expect(workspace).toContain('if (checkpointPendingRef.current)')
    expect(workspace).not.toContain('signal.aborted')
  })
})
