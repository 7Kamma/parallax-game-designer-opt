import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkspaceFolders } from './workspace'

it('searches an authorized folder with headings and line references, keeping linked files outside the results', async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'parallax-workspace-test-')))
  try {
    const folder = join(temp, 'design')
    const outside = join(temp, 'outside')
    await mkdir(folder)
    await mkdir(outside)
    await writeFile(join(folder, 'combat.md'), '# 七相试炼\n\n## 防守机制\n格挡消耗耐力。\n\n## 奖励\n胜利后结算奖励。')
    await writeFile(join(folder, 'playtest.txt'), Buffer.from('\uFEFFshield block test\nWatch recovery time.\n', 'utf16le'))
    await writeFile(join(outside, 'notes.md'), '# Outside\n格挡 OUTSIDE_MARKER')
    await symlink(outside, join(folder, 'linked'), 'junction')
    await link(join(outside, 'notes.md'), join(folder, 'shortcut.md'))
    const registry = join(temp, 'profile', 'workspaces.json')
    const first = new WorkspaceFolders(registry)
    const chosen = await first.add(folder)
    const second = new WorkspaceFolders(registry)
    await second.load()
    const signal = new AbortController().signal
    const result = await second.search(chosen.id, ['格挡', 'shield block'], signal)
    expect(result.excerpts).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'combat.md', section: '七相试炼 › 防守机制', firstLine: 3, text: expect.stringContaining('格挡消耗耐力') }),
      expect.objectContaining({ file: 'playtest.txt', section: '', firstLine: 1, text: expect.stringContaining('shield block test') }),
    ]))
    expect(result.excerpts.map(({ file }) => file).sort()).toEqual(['combat.md', 'playtest.txt'])
    expect(() => second.search(outside, ['格挡'], signal)).toThrow('Choose the workspace folder again')
    await expect(second.search(chosen.id, ['格挡'], AbortSignal.abort())).rejects.toThrow()
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
