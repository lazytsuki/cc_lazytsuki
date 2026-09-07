import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseThoughtPosition, savedPositionIsNewer, thoughtPositionKey } from '@/src/hooks/use-thought-position'
import { isMarkdownContent, markdownToPlainText } from '@/src/lib/markdown'
import { aiOutputForDisplay } from '@/src/lib/ai-output'
import { mergeThoughts } from '@/src/components/thoughts/thought-navigation'
import type { ThoughtSummary } from '@/src/components/thoughts/thought-workspace'

describe('thought workspace acceptance boundaries', () => {
  it('merges more than twenty old ideas without duplicates', () => {
    const summary = (index: number): ThoughtSummary => ({
      id: `thought-${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 20, 0, index)).toISOString(),
      lastActivityAt: new Date(Date.UTC(2026, 7, 20, 0, index)).toISOString(),
      relationCheckedAt: null,
      collectionId: null,
      archivedAt: null,
      deletedAt: null,
      firstEntry: null,
    })
    const firstPage = Array.from({ length: 20 }, (_, index) => summary(index))
    const nextPage = [summary(19), ...Array.from({ length: 5 }, (_, index) => summary(index + 20))]

    const merged = mergeThoughts(firstPage, nextPage)

    expect(merged).toHaveLength(25)
    expect(merged[0].id).toBe('thought-24')
    expect(merged.at(-1)?.id).toBe('thought-0')
  })

  it('restores only a valid position for the same thought', () => {
    expect(thoughtPositionKey('thought-1')).toBe('retniw:thought-position:thought-1')
    expect(parseThoughtPosition('{"scrollY":320,"selectionStart":4,"selectionEnd":7,"updatedAt":2000}')).toEqual({
      scrollY: 320,
      selectionStart: 4,
      selectionEnd: 7,
      updatedAt: 2000,
    })
    expect(parseThoughtPosition('{"scrollY":320,"selectionStart":4,"selectionEnd":7}')?.updatedAt).toBe(0)
    expect(parseThoughtPosition('{"scrollY":-1,"selectionStart":0,"selectionEnd":0}')).toBeNull()
    expect(parseThoughtPosition('broken')).toBeNull()
  })

  it('lets the newer of a checkpoint and a manual reading position win', () => {
    const saved = { scrollY: 320, selectionStart: 0, selectionEnd: 0, updatedAt: 2_000 }
    expect(savedPositionIsNewer(saved, new Date(1_000).toISOString())).toBe(true)
    expect(savedPositionIsNewer(saved, new Date(3_000).toISOString())).toBe(false)
    expect(savedPositionIsNewer(saved)).toBe(true)
  })

  it('does not stop position saves when a link click is cancelled in the bubble phase', async () => {
    const positionHook = await readFile('src/hooks/use-thought-position.ts', 'utf8')
    const saveBeforeDeferredDecision = positionHook.indexOf('save()\n      queueMicrotask')
    expect(saveBeforeDeferredDecision).toBeGreaterThan(-1)
    expect(positionHook).toContain('if (!event.defaultPrevented) navigationStarted.current = true')
  })

  it('keeps API and export responses outside Service Worker caching', async () => {
    const source = await readFile('public/sw.js', 'utf8')
    const apiGuard = source.indexOf("url.pathname.startsWith('/api/')")
    const navigationHandler = source.indexOf("request.mode === 'navigate'")
    expect(apiGuard).toBeGreaterThan(-1)
    expect(apiGuard).toBeLessThan(navigationHandler)
    expect(source).not.toContain("cache.put('/api")
  })

  it('has both desktop and mobile workspace layouts', async () => {
    const css = await readFile('src/index.css', 'utf8')
    expect(css).toContain('--workspace-sidebar-width: clamp(230px, 20vw, 280px)')
    expect(css).toContain('grid-template-columns: var(--workspace-sidebar-width) minmax(0, 1fr)')
    expect(css).toMatch(/\.thought-layout--sidebar-collapsed \{[\s\S]*--workspace-sidebar-width: 52px;[\s\S]*--workspace-sidebar-gap: 16px;[\s\S]*--workspace-main-leading: 1fr;/)
    expect(css).toMatch(/@media \(min-width: 901px\) \{[\s\S]*grid-template-columns:[\s\S]*var\(--workspace-main-leading\)[\s\S]*var\(--thought-main-max-width\)[\s\S]*\.thought-main \{[\s\S]*grid-column: 4;/)
    expect(css).toContain('--workspace-motion-easing: cubic-bezier(0.22, 1, 0.36, 1)')
    expect(css).not.toMatch(/\.thought-layout--sidebar-collapsed \.thought-main \{[\s\S]*justify-self/)
    expect(css).toMatch(/\.app-header--sidebar-collapsed \{[\s\S]*--workspace-sidebar-width: 52px;[\s\S]*column-gap: 16px;/)
    expect(css).toMatch(/@media \(min-width: 901px\)[\s\S]*\.app-header \{[\s\S]*position: sticky/)
    expect(css).toMatch(/\.thought-sidebar \{[\s\S]*top: calc\(48px \+ var\(--thought-sidebar-top\)\)/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.thought-layout[\s\S]*grid-template-columns: 1fr/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.mobile-workspace-toolbar[\s\S]*display: flex/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.mobile-workspace-toolbar \{[\s\S]*position: sticky/)
    expect(css).toMatch(/\.thought-history-dialog \{[\s\S]*inset: 0 auto 0 0;[\s\S]*height: 100dvh;/)
    expect(css).toMatch(/\.thought-history-dialog \{[\s\S]*border-radius: 0 22px 22px 0;/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*#current-thought,[\s\S]*\.thought-entry\[id\] \{[\s\S]*scroll-margin-top: 82px/)
    expect(css).toContain('@media (max-width: 560px)')
  })

  it('keeps page chrome and action groups inside narrow mobile viewports', async () => {
    const css = await readFile('src/index.css', 'utf8')
    const shellRule = css.match(/\.app-shell \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(shellRule).toContain('width: 100%')
    expect(shellRule).not.toContain('max-width: 1440px')
    expect(shellRule).not.toContain('margin: 0 auto')
    expect(shellRule).toContain('max(16px, env(safe-area-inset-left))')
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.app-shell \{[\s\S]*max-width: 732px;[\s\S]*margin: 0 auto;/)
    expect(css).toMatch(/\.app-header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/)
    expect(css).toContain('padding-bottom: calc(80px + env(safe-area-inset-bottom))')
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.thinking-assist/)
    expect(css).not.toContain('grid-template-columns: minmax(420px, 0.92fr)')
    expect(css).not.toContain('grid-template-columns: minmax(0, 1.05fr) minmax(400px, 0.95fr)')
  })

  it('renders AI and Markdown imports as Markdown without formatting user text', async () => {
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const entryContent = await readFile('src/components/thoughts/entry-content.tsx', 'utf8')
    expect(workspace).toContain('isMarkdownContent(entry.entryType, entry.sourceLabel)')
    expect(entryContent).toContain('react-markdown')
    expect(entryContent).toContain('remark-gfm')
    expect(entryContent).toContain('entry-content--plain')
    expect(isMarkdownContent('ai', null)).toBe(true)
    expect(isMarkdownContent('import', 'notes.md')).toBe(true)
    expect(isMarkdownContent('import', 'notes.txt')).toBe(false)
    expect(isMarkdownContent('user', null)).toBe(false)
    expect(markdownToPlainText('# 标题\n\n这是 **粗体**。\n\n- 第一项')).toBe('标题 这是 粗体。 第一项')
    expect(aiOutputForDisplay('可以继续写：当时发生了什么？', 'advance')).toBe('当时发生了什么？')
    expect(aiOutputForDisplay('原样保留', 'organize')).toBe('原样保留')
  })

  it('keeps the import dialog centered independently of the workspace grid', async () => {
    const css = await readFile('src/index.css', 'utf8')
    expect(css).toMatch(/\.import-dialog \{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*margin: auto;/)
    expect(css).toContain('max-height: calc(100dvh - 32px)')
    expect(css).toContain('overflow-y: auto')
  })

  it('presents one natural product path and separates actions by user intent', async () => {
    const capturePage = await readFile('app/page.tsx', 'utf8')
    const header = await readFile('src/components/app-header.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    const listItem = await readFile('src/components/thoughts/thought-list-item.tsx', 'utf8')
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const assist = await readFile('src/components/thoughts/thinking-assist.tsx', 'utf8')
    const menu = await readFile('src/components/thoughts/thought-menu.tsx', 'utf8')
    const provider = await readFile('src/server/ai/deepseek-text-provider.ts', 'utf8')

    expect(header).not.toContain('back-link')
    expect(header).not.toContain('href="/"')
    expect(header).toContain('account-menu')
    expect(navigation).toContain('写新想法')
    expect(navigation).toContain('以前的想法')
    expect(navigation).not.toContain('当前想法')
    expect(navigation).toContain('className="mobile-workspace-toolbar"')
    expect(navigation).toContain('<nav className="mobile-workspace-toolbar" aria-label="想法导航">')
    expect(navigation).toContain("currentStarted || activeView === 'review'")
    expect(navigation).toContain('aria-haspopup="dialog"')
    expect(navigation).not.toContain("aria-current={activeView === 'review' ? 'page' : undefined}\n          aria-expanded={historyOpen}")
    expect(navigation).toContain('href="/review"')
    expect(navigation).toContain('<span>回看</span>')
    expect(navigation).not.toContain('看看有没有联系')
    expect(navigation).not.toContain("kind: 'deleted'")
    expect(navigation).toContain("params.set('cursor', cursor)")
    expect(navigation).toContain("sessionStorage.setItem(explicitNewThoughtKey, '1')")
    expect(listItem).toContain("timeZone: 'Asia/Shanghai'")
    expect(listItem).toContain('prefetch={false}')
    expect(workspace).toContain('写下你正在想的。')
    expect(workspace).toMatch(/entries\.length > 0 && \([\s\S]*<ThinkingAssist/)
    expect(workspace).toContain('if (item.thoughtId !== thoughtIdRef.current) return')
    expect(workspace).toContain('thoughtIdRef.current = restored.thoughtId')
    expect(workspace).toContain('if (explicitlyStartedNewThought) return')
    expect(workspace).toContain("router.replace(`/thoughts/${thoughtId}`, { scroll: false })")
    expect(workspace).toContain('}, [activeOutbox, router, thoughtId])')
    expect(workspace).not.toContain("window.history.replaceState(null, '', `/thoughts/${thoughtId}`)")
    expect(workspace).not.toContain('void checkRelation(item.thoughtId)')
    expect(workspace).not.toContain('useRelationCheck')
    expect(workspace).not.toContain('<RelationCandidate')
    expect(workspace).toContain('id={`entry-${entry.id}`}')
    expect(assist).toContain('帮我接着想')
    expect(assist).not.toContain('href="/review"')
    expect(assist).not.toContain('串联已有想法')
    expect(workspace).toContain('className="workspace-import-action"')
    expect(workspace).toContain("overlay.open('import', event.currentTarget)")
    expect(workspace).toContain('const [serverReady, setServerReady] = useState(Boolean(initialThought))')
    expect(workspace).toContain('if (item.createsThought) setServerReady(true)')
    expect(workspace).toContain('serverReady && entries.length > 0')
    expect(workspace).toContain('initialThought?.archivedAt')
    expect(workspace).toContain('const targetThoughtId = createsThought ? requestIds.thoughtId : thoughtId')
    expect(workspace).toContain('entryId: requestIds.entryId')
    expect(workspace).toContain('clientRequestId: requestIds.clientRequestId')
    expect(workspace).toContain('importDisabled={directWritePending || aiWritePending || entryWritePending}')
    expect(workspace).toContain('queueingEntryRef.current = true')
    expect(workspace).toContain('setQueueingEntry(false)')
    expect(assist).not.toContain("action: 'question'")
    expect(assist).not.toContain("action: 'organize'")
    expect(menu).toContain('整理内容')
    expect(provider).not.toContain('第一句以“可以继续写：”开头')
    expect(capturePage).toContain('key={`new-thought:${userId}`}')
  })

  it('keeps mobile writing in the document flow with explicit save semantics', async () => {
    const composer = await readFile('src/components/thoughts/thought-composer.tsx', 'utf8')
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const css = await readFile('src/index.css', 'utf8')

    expect(workspace).toContain('autoFocus={!started}')
    expect(composer).toContain('Boolean(event.metaKey || event.ctrlKey)')
    expect(composer).toContain("thought-composer--initial")
    expect(composer).toContain("data-mode={hasEntries ? 'continuation' : 'initial'}")
    expect(composer).toContain('usePointerGlow<HTMLDivElement>()')
    expect(composer).toContain('data-pointer-glow="capture"')
    expect(composer).toContain('>继续写</label>')
    expect(composer).toContain('补充一个新的点，或继续刚才的思路')
    expect(composer).toContain('写好后，点保存')
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.capture-shortcut-hint \{[\s\S]*display: none;[\s\S]*\.capture-mobile-hint \{[\s\S]*display: inline;/)
    expect(css.match(/\.capture-mobile-hint \{\s*display: inline;/g)).toHaveLength(1)
    expect(css).not.toMatch(/\.thought-composer\[data-mode="continuation"\] \{[\s\S]*?(?:border-color|background|box-shadow):/)
    expect(css).not.toContain('.thought-composer[data-mode="continuation"]:focus-within')
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.thought-composer,[\s\S]*border-color: rgb\(255 255 255 \/ 16%\)/)
    expect(css).not.toMatch(/\.thought-composer--initial(?:,|:focus-within)[^{]*\{[\s\S]*?(?:border-color|background|box-shadow):/)
    expect(css).toMatch(/\.thought-composer--initial textarea \{[\s\S]*min-height: clamp\(200px, 32dvh, 320px\)/)
    expect(css).not.toMatch(/\.thought-composer \{[\s\S]*position: fixed/)
  })

  it('makes imported tables, deep entry links, and subtle pointer feedback usable without adding dependencies', async () => {
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const entryContent = await readFile('src/components/thoughts/entry-content.tsx', 'utf8')
    const pointerGlow = await readFile('src/hooks/use-pointer-glow.ts', 'utf8')
    const css = await readFile('src/index.css', 'utf8')

    expect(entryContent).toContain('className="entry-table-scroll"')
    expect(entryContent).toContain('role="region"')
    expect(entryContent).toContain('tabIndex={0}')
    expect(css).toMatch(/\.thought-entry:target,[\s\S]*\.thought-entry--target \{[\s\S]*box-shadow: inset 3px 0 0/)
    expect(workspace).toContain("behavior: reducedMotion ? 'auto' : 'smooth'")
    expect(workspace).toMatch(/window\.addEventListener\('hashchange', revealLinkedEntry\)[\s\S]*?\}, \[thoughtId\]\)/)
    expect(css).toMatch(/\.entry-table-scroll \{[\s\S]*overflow-x: auto/)
    expect(css).toContain('tbody tr:nth-child(even)')
    expect(pointerGlow).toContain("'(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'")
    expect(css).toContain('[data-pointer-glow][data-pointer-glow-active="true"]::before')
  })

  it('provides a skip link, visible keyboard focus, and readable secondary text', async () => {
    const layout = await readFile('app/layout.tsx', 'utf8')
    const page = await readFile('app/page.tsx', 'utf8')
    const css = await readFile('src/index.css', 'utf8')

    expect(layout).toContain('className="skip-link" href="#main-content"')
    expect(page).toContain('id="main-content" tabIndex={-1}')
    expect(css).toContain('--text-subtle: rgb(245 245 243 / 55%)')
    expect(css).toMatch(/button:focus-visible,[\s\S]*outline: 2px solid var\(--focus-ring\) !important/)
    expect(css).toMatch(/\.capture-surface:focus-within \{[\s\S]*border-color: rgb\(191 216 208 \/ 34%\)/)
    expect(css).toMatch(/\.thought-composer textarea:focus-visible \{\s*outline: none !important;\s*\}/)
    expect(css).not.toMatch(/color: rgb\(245 245 243 \/ (?:2\d|3\d|4\d)%\)/)
  })

  it('opts into a quiet sticky header only for the desktop workspace', async () => {
    const css = await readFile('src/index.css', 'utf8')
    const headerRule = css.match(/\.app-header \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(headerRule).not.toContain('position: sticky')
    expect(headerRule).not.toContain('backdrop-filter')
    expect(headerRule).not.toContain('border:')
    expect(headerRule).not.toContain('background:')
    expect(css).toMatch(/@media \(min-width: 901px\)[\s\S]*\.app-header \{[\s\S]*position: sticky;[\s\S]*backdrop-filter: blur\(14px\)/)
    expect(css).toMatch(/#current-thought,[\s\S]*\.thought-entry\[id\] \{[\s\S]*scroll-margin-top: 72px/)
  })

  it('scrolls only the desktop history body and keeps secondary actions fixed', async () => {
    const css = await readFile('src/index.css', 'utf8')
    const sidebarRules = [...css.matchAll(/\.thought-sidebar \{([\s\S]*?)\n\}/g)].map((match) => match[1])
    const scrollRule = css.match(/\.thought-navigation__scroll \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const footerRule = css.match(/\.thought-navigation__footer \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const shellRule = css.match(/\.app-shell \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(sidebarRules.some((rule) => rule.includes('flex-direction: column') && rule.includes('overflow: visible'))).toBe(true)
    expect(scrollRule).toContain('min-height: 0')
    expect(scrollRule).toContain('overflow-x: hidden')
    expect(scrollRule).toContain('overflow-y: auto')
    expect(footerRule).toContain('flex: 0 0 auto')
    expect(shellRule).toContain('24px max(16px, env(safe-area-inset-left))')
    expect(css).not.toMatch(/\.thought-link:hover \{[\s\S]*?translateX/)
  })

  it('shares one accessible desktop collapse state across workspace page types without changing mobile navigation', async () => {
    const rootLayout = await readFile('app/layout.tsx', 'utf8')
    const provider = await readFile('src/components/workspace-sidebar-provider.tsx', 'utf8')
    const thoughtLayout = await readFile('src/components/thoughts/thought-layout.tsx', 'utf8')
    const header = await readFile('src/components/app-header.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const reviewPage = await readFile('app/review/page.tsx', 'utf8')
    const skeleton = await readFile('src/components/thoughts/thought-skeleton.tsx', 'utf8')
    const css = await readFile('src/index.css', 'utf8')

    expect(rootLayout).toContain('<WorkspaceSidebarProvider>')
    expect(provider).toContain('const [collapsed, setCollapsed] = useState(false)')
    expect(thoughtLayout).toContain("collapsed ? 'thought-layout--sidebar-collapsed' : ''")
    expect(workspace).toContain('<ThoughtLayout>')
    expect(reviewPage).toContain('<ThoughtLayout>')
    expect(skeleton).toContain('<ThoughtLayout className="thought-skeleton">')

    expect(header).toContain('aria-label="收起侧边栏"')
    expect(header).toContain('aria-label="展开侧边栏"')
    expect(header).toContain('data-sidebar-tooltip="收起侧边栏"')
    expect(header).toContain('data-sidebar-tooltip="展开侧边栏"')
    expect(header).toContain('if (event.detail === 0)')
    expect(header).toContain('window.requestAnimationFrame(() => expandRef.current?.focus())')
    expect(navigation).toContain('data-collapsed={sidebar.collapsed || undefined}')
    expect(navigation).toContain("sidebar.expand()")
    expect(navigation).toContain('window.requestAnimationFrame(() => expandedArchiveRef.current?.focus())')
    expect(navigation).toContain("secondaryNavigation('sidebar', true)")
    expect(navigation).toContain('data-sidebar-tooltip={sidebar.collapsed ? \'写新想法\' : undefined}')
    expect(css).toMatch(/\.sidebar-expand-action:hover \.sidebar-expand-action__logo,[\s\S]*opacity: 0/)
    expect(css).toMatch(/\.app-header--sidebar-collapsed \.app-header__sidebar \{[\s\S]*justify-content: center/)
    expect(css).toContain('.thought-navigation__secondary.thought-navigation__footer--compact > button')
    expect(css).toMatch(/\.thought-layout--sidebar-collapsed\.thought-skeleton \.thought-sidebar \{[\s\S]*overflow: hidden/)
    expect(css).toMatch(/\.thought-history-dialog\[open\] \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.thought-sidebar \{[\s\S]*display: none/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.mobile-app-brand \{[\s\S]*display: inline-flex/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.app-header--sidebar-collapsed \.app-header__sidebar \{[\s\S]*justify-content: flex-start/)
  })

  it('keeps transient thought actions outside clipped list rows', async () => {
    const actionMenu = await readFile('src/components/thoughts/thought-action-menu.tsx', 'utf8')
    const listItem = await readFile('src/components/thoughts/thought-list-item.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    const overlayProvider = await readFile('src/components/overlay-provider.tsx', 'utf8')
    const css = await readFile('src/index.css', 'utf8')

    expect(actionMenu).toContain("import { createPortal } from 'react-dom'")
    expect(actionMenu).toContain("document.getElementById('thought-history-layer-root')")
    expect(actionMenu).toContain('createPortal(actionLayer, portalTarget)')
    expect(navigation).toContain('id="thought-history-layer-root"')
    expect(css).toMatch(/\.thought-list-item \{[\s\S]*?overflow: hidden;/)
    expect(css).toMatch(/\.thought-list-item__swipe-actions\[aria-hidden="true"\] \{[\s\S]*?visibility: hidden;[\s\S]*?opacity: 0;/)
    expect(css).toMatch(/\.thought-action-menu__panel,[\s\S]*?\.collection-picker-layer \{[\s\S]*?position: fixed;/)
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.thought-action-menu__panel,[\s\S]*?inset: auto 0 0;/)
    expect(overlayProvider).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]*?triggerRef\.current = null/)
    expect(overlayProvider).toContain('if (activeIdRef.current !== null) return')
    expect(overlayProvider).toContain('focusHasNowhereUsefulToGo')
    expect(overlayProvider).toContain('window.requestAnimationFrame')
    expect(overlayProvider).toMatch(/event\.key !== 'Escape'[\s\S]*?event\.preventDefault\(\)[\s\S]*?overlay\.close\(id\)/)
    expect(actionMenu).toContain("'[role=\"menuitem\"]:not(:disabled)'")
    expect(actionMenu).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']")
    expect(actionMenu).toContain('onKeyDown={navigateMenu}')
    expect(actionMenu).toContain("?.focus({ preventScroll: true })")
    expect(listItem).toContain('if (longPressOpened.current)')
    expect(listItem).toContain("document.getElementById(`${menuId}:panel`)")
    expect(listItem).toContain("transition: itemOverlayOpen ? 'none' : undefined")
  })

  it('separates history, swipe state, archive, and permanent deletion', async () => {
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    const captureStore = await readFile('src/lib/capture/capture-store.ts', 'utf8')
    const listItem = await readFile('src/components/thoughts/thought-list-item.tsx', 'utf8')
    const checkpoint = await readFile('src/components/thoughts/checkpoint-dialog.tsx', 'utf8')

    expect(navigation).toContain('const [historyOpen, setHistoryOpen] = useState(false)')
    expect(navigation).not.toContain("overlay.isOpen('history')")
    expect(navigation).toContain("if (overlay.activeId?.includes(':history:')) closeOverlay()")
    expect(navigation).toContain('const [revealedThoughtId, setRevealedThoughtId]')
    expect(navigation).toContain('setRevealedThoughtId(thought.id)')
    expect(navigation).toContain('onConceal={() => setRevealedThoughtId(null)}')
    expect(navigation).toContain('只删除合集，不会删除里面的想法。')
    expect(navigation).toContain('还没有归档的想法。')
    expect(navigation).toContain('aria-label="返回以前的想法"')
    expect(navigation).not.toContain('>全部</button>')
    expect(navigation).toContain('删除后无法恢复，相关联系也会一并删除。')
    expect(navigation).toMatch(/userBoundFetch\(userId, `\/api\/thoughts\/\$\{thought\.id\}`, \{[\s\S]*?method: 'DELETE'/)
    expect(navigation).not.toContain('AbortController')
    expect(navigation).toContain("response.status !== 204 && response.status !== 404")
    expect(navigation).toContain('discardThoughtOutboxItems(userId, thought.id)')
    expect(captureStore).toContain("store.index('thoughtId').openCursor")
    expect(captureStore).toContain("(cursor.value as ThoughtOutboxItem).userId === userId")
    expect(navigation).toContain("deletingThought ? '正在删除' : '删除'")
    expect(listItem).not.toContain("mode === 'deleted'")
    expect(listItem).not.toContain('thought-link--deleted')
    expect(listItem).toContain("onAction(thought, 'unarchive'")
    expect(listItem).toContain('取消归档')
    expect(checkpoint).toContain('requestIdsRef.current ??= nextRequestIds()')
    expect(checkpoint).toContain('回到全部想法')
  })

  it('ignores stale view and load-more responses after another navigation request starts', async () => {
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')
    expect(navigation).toContain('const viewRequestEpochRef = useRef(0)')
    expect(navigation.match(/requestEpoch !== viewRequestEpochRef\.current/g)).toHaveLength(4)
    expect(navigation).toContain('const requestedView = view')
    expect(navigation).toContain('queryFor(requestedView, nextCursor)')
    expect(navigation).toMatch(/function showRecent\(\) \{[\s\S]*?viewRequestEpochRef\.current \+= 1/)
    expect(navigation).toMatch(/setView\(nextView\)[\s\S]*?setViewThoughts\(\[\]\)[\s\S]*?setNextCursor\(null\)[\s\S]*?setLoading\(true\)/)
    expect(navigation).toContain('className="thought-list-loading" role="status">正在加载')
    expect(navigation).toContain("visibleThoughts.length === 0 && !loadError")
  })

  it('loads collections with the initial server data instead of after hydration', async () => {
    const capturePage = await readFile('app/page.tsx', 'utf8')
    const thoughtPage = await readFile('app/thoughts/[id]/page.tsx', 'utf8')
    const workspace = await readFile('src/components/thoughts/thought-workspace.tsx', 'utf8')
    const navigation = await readFile('src/components/thoughts/thought-navigation.tsx', 'utf8')

    expect(capturePage).toContain('Promise.all([')
    expect(capturePage).toContain('new CollectionRepository(client).list(userId)')
    expect(thoughtPage).toContain('[data, recent, initialCollections] = await Promise.all([')
    expect(thoughtPage).toContain('new CollectionRepository(client).list(user.id)')
    expect(workspace).toContain('initialCollections={initialCollections}')
    expect(navigation).toContain('useState<ThoughtCollection[]>(initialCollections ?? [])')
    expect(navigation).toContain('if (initialCollections !== null) return')
    expect(navigation).toContain("userBoundFetch(userId, '/api/collections')")
  })

  it('keeps the README focused on the current product path and public entry', async () => {
    const readme = await readFile('README.md', 'utf8')
    expect(readme).toContain('https://retniw.cn')
    expect(readme).toContain('retniw 用来记录和整理自己的想法')
    expect(readme).toContain('平时记录不会自动调用 AI')
    expect(readme).toContain('[LICENSE](LICENSE)')
    expect(readme).toContain('可以个人或商业使用、修改和分发')
    expect(readme).not.toContain('先记下来，慢慢表达')
    expect(readme).not.toContain('retniw.vercel.app')
  })
})
