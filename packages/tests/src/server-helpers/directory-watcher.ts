/* oxlint-disable @typescript-eslint/no-unused-expressions */

import { compareLiveFilenames, wait } from '@peertube/peertube-core-utils'
import { DirectoryWatcher } from '@peertube/peertube-node-utils'
import { expect } from 'chai'
import { mkdtemp, rename, rm, symlink, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'

describe('Directory watcher', function () {
  let directory: string
  let watcher: DirectoryWatcher

  let added: string[]
  let unlinked: string[]
  let errors: Error[]

  async function buildWatcher (options: {
    filter?: (filename: string) => boolean
    sort?: (a: string, b: string) => number
  } = {}) {
    added = []
    unlinked = []
    errors = []

    watcher = new DirectoryWatcher({
      directory,
      filter: options.filter ?? (filename => filename.endsWith('.ts')),
      sort: options.sort
    })

    watcher.on('add', p => added.push(basename(p)))
    watcher.on('unlink', p => unlinked.push(basename(p)))
    watcher.on('error', err => errors.push(err))

    watcher.watch()

    // Let the initial listing run
    await watcher.flush()

    return watcher
  }

  // The events of the OS watcher are asynchronous: don't rely on a fixed delay, that a loaded CI runner may exceed
  async function waitUntil (condition: () => boolean) {
    const deadline = Date.now() + 20000

    while (!condition() && Date.now() < deadline) {
      await wait(100)
    }
  }

  function segmentName (playlistId: number, counter: number) {
    return `${playlistId}-${counter.toString().padStart(6, '0')}.ts`
  }

  function writeSegment (playlistId: number, counter: number) {
    return writeFile(join(directory, segmentName(playlistId, counter)), 'segment')
  }

  beforeEach(async function () {
    directory = await mkdtemp(join(tmpdir(), 'peertube-directory-watcher-'))
  })

  afterEach(async function () {
    await watcher?.close()
    watcher = undefined

    await rm(directory, { recursive: true, force: true })
  })

  it('Should emit an add for the files the directory already contains', async function () {
    await writeSegment(0, 1)
    await writeSegment(0, 2)
    await writeFile(join(directory, 'segments-sha256.json'), '{}')

    await buildWatcher()

    expect(added).to.deep.equal([ '0-000001.ts', '0-000002.ts' ])
    expect(unlinked).to.be.empty
    expect(errors).to.be.empty
  })

  it('Should not emit an event for a filtered out file', async function () {
    await buildWatcher()

    await writeFile(join(directory, 'segments-sha256.json'), '{}')
    await writeFile(join(directory, '0-000001.ts.tmp'), 'incomplete')
    await watcher.flush()

    expect(added).to.be.empty
    expect(unlinked).to.be.empty
  })

  it('Should emit an add and an unlink of a file, in the order they appeared', async function () {
    await buildWatcher()

    for (let i = 1; i <= 20; i++) {
      await writeSegment(0, i)
    }
    await watcher.flush()

    expect(added).to.deep.equal(new Array(20).fill(null).map((_v, i) => segmentName(0, i + 1)))

    await unlink(join(directory, segmentName(0, 1)))
    await unlink(join(directory, segmentName(0, 2)))
    await watcher.flush()

    expect(unlinked).to.deep.equal([ segmentName(0, 1), segmentName(0, 2) ])
    expect(errors).to.be.empty
  })

  it('Should emit a single add for a file that is rewritten', async function () {
    await buildWatcher({ filter: filename => filename.endsWith('.m3u8') })

    // ffmpeg writes its playlists in a temporary file that it renames on the target
    for (let i = 0; i < 3; i++) {
      await writeFile(join(directory, '0.m3u8.tmp'), 'playlist v' + i)
      await rename(join(directory, '0.m3u8.tmp'), join(directory, '0.m3u8'))
      await watcher.flush()
    }

    expect(added).to.deep.equal([ '0.m3u8' ])
    expect(unlinked).to.be.empty
  })

  it('Should emit an add again for a file that is recreated', async function () {
    await buildWatcher()

    await writeSegment(0, 1)
    await watcher.flush()
    await unlink(join(directory, segmentName(0, 1)))
    await watcher.flush()
    await writeSegment(0, 1)
    await watcher.flush()

    expect(added).to.deep.equal([ segmentName(0, 1), segmentName(0, 1) ])
    expect(unlinked).to.deep.equal([ segmentName(0, 1) ])
  })

  it('Should emit the files of a listing in the order of the sort option', async function () {
    // The counter of a segment is zero padded, but it grows past its padding on a long lasting live
    for (const counter of [ 1000000, 2, 1 ]) {
      await writeSegment(0, counter)
    }

    await writeFile(join(directory, '0.m3u8'), 'playlist')
    await writeFile(join(directory, 'master.m3u8'), 'master playlist')

    await buildWatcher({
      filter: filename => filename.endsWith('.ts') || filename.endsWith('.m3u8'),
      sort: compareLiveFilenames
    })

    // The playlists first: the handlers of a segment need the playlist that references it
    expect(added).to.deep.equal([
      '0.m3u8',
      'master.m3u8',
      segmentName(0, 1),
      segmentName(0, 2),
      segmentName(0, 1000000)
    ])
    expect(errors).to.be.empty
  })

  it('Should recover the events the OS watcher never sent us', async function () {
    await buildWatcher()

    // Simulate a dropped event: the file exists but nothing notified the watcher about it
    await watcher.close()
    await writeSegment(0, 1)

    await buildWatcher()

    expect(added).to.deep.equal([ segmentName(0, 1) ])
  })

  it('Should keep emitting the other files after one of them cannot be checked', async function () {
    await buildWatcher()

    // Create everything in the same tick, so the checks of the segments are queued behind the one that fails
    // A symlink pointing at itself is listed by the directory, but stat() fails on it with ELOOP
    await Promise.all([
      symlink('loop.ts', join(directory, 'loop.ts')),
      ...new Array(20).fill(null).map((_v, i) => writeSegment(0, i + 1))
    ])

    // Don't flush: a full listing does not stat the entries, so only the event path can hit the error
    // The OS can notify us more than once of the symlink, so we can stat it (and fail) more than once
    await waitUntil(() => errors.length !== 0 && added.length === 20)

    expect(errors).to.not.be.empty
    for (const err of errors) {
      expect((err as any).code).to.equal('ELOOP')
    }

    // The files queued behind the one we cannot check must still be emitted
    expect(added.sort()).to.deep.equal(new Array(20).fill(null).map((_v, i) => segmentName(0, i + 1)))
  })

  it('Should not emit anything anymore once closed', async function () {
    await buildWatcher()

    await watcher.close()

    await writeSegment(0, 1)
    await wait(500)

    expect(added).to.be.empty
    expect(errors).to.be.empty
  })

  it('Should be able to be closed twice', async function () {
    await buildWatcher()

    await watcher.close()
    await watcher.close()
  })

  it('Should resolve every close() call and let the directory be removed', async function () {
    await buildWatcher()

    for (let i = 1; i <= 50; i++) {
      await writeSegment(0, i)
    }

    // A first caller that does not wait for the checks in flight must not let the next ones resolve before they end
    void watcher.close()

    await watcher.close()
    await rm(directory, { recursive: true, force: true })

    await wait(500)

    expect(errors).to.be.empty
  })
})
