import { describe, expect, it } from 'vitest'
import { shouldSubmitThought, thoughtComposerCopy } from '@/src/components/thoughts/thought-composer'

describe('thought composer keyboard behavior', () => {
  it('uses different copy for a new idea and the current idea', () => {
    expect(thoughtComposerCopy(false)).toEqual({
      ariaLabel: '写在这里',
      placeholder: '从这里开始写',
    })
    expect(thoughtComposerCopy(true)).toEqual({
      ariaLabel: '继续写',
      placeholder: '补充一个新的点，或继续刚才的思路',
    })
  })

  it.each(['metaKey', 'ctrlKey'])('saves with %s + Enter', (modifier) => {
    expect(
      shouldSubmitThought({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, [modifier]: true }),
    ).toBe(true)
  })

  it('keeps Return as a newline on every device', () => {
    expect(
      shouldSubmitThought({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }),
    ).toBe(false)
  })

  it.each([
    { key: 'Enter', ctrlKey: true, shiftKey: true, isComposing: false, keyCode: 13 },
    { key: 'Enter', metaKey: true, shiftKey: false, isComposing: true, keyCode: 13 },
    { key: 'Enter', ctrlKey: true, shiftKey: false, isComposing: false, keyCode: 229 },
    { key: 'a', metaKey: true, shiftKey: false, isComposing: false, keyCode: 65 },
  ])('does not submit for a newline or IME composition', (event) => {
    expect(shouldSubmitThought(event)).toBe(false)
  })
})
