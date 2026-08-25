import { FSWatcher, watch } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { TypedEventEmitter } from './typed-event-emitter.js'

// Delay between the full directory listings used to recover the events the OS watcher may have dropped
const RECONCILE_INTERVAL = 10000
// A directory the OS watcher keeps reporting is unlikely to have dropped an event, and listing it is expensive when it
// holds thousands of files: reconcile it less often, but still often enough to recover an event it dropped anyway
const BUSY_RECONCILE_INTERVAL = 60000

export interface DirectoryWatcherOptions {
  directory: string

  // Only the filenames accepted by this filter emit events
  filter: (filename: string) => boolean

  // The OS watcher notifies us of the files in the order they appeared
  // But a full directory listing has to rebuild that order (default: by filename)
  sort?: (a: string, b: string) => number
}

interface DirectoryWatcherEvents {
  'add': (path: string) => void
  'unlink': (path: string) => void

  'error': (err: Error) => void
}

// Emit an 'add'/'unlink' event with the full path of the files of a directory that appear/disappear
class DirectoryWatcher extends TypedEventEmitter<DirectoryWatcherEvents> {
  private readonly directory: string
  private readonly filter: (filename: string) => boolean
  private readonly sort: (a: string, b: string) => number

  // Filenames we emitted an 'add' for, so we don't emit it twice and know which 'unlink' we have to emit
  private readonly knownFilenames = new Set<string>()

  // Filenames the OS watcher notified us about, waiting to be checked
  // A Set keeps them in event order, which the consumers rely on to process the files in the order they appeared
  private readonly pendingFilenames = new Set<string>()

  private watcher: FSWatcher

  private reconcileTimer: NodeJS.Timeout
  // The OS watcher did not tell us which file changed, or we may have missed events: list the whole directory
  private reconcileRequested = true
  private lastReconcileDate = 0
  private osEventSinceLastReconcile = false

  private processingPromise: Promise<void>
  private closePromise: Promise<void>
  private closed = false

  constructor (options: DirectoryWatcherOptions) {
    super()

    this.directory = options.directory
    this.filter = options.filter
    this.sort = options.sort
  }

  // Starts watching the directory, and emits an 'add' for the files it already contains
  watch () {
    if (this.watcher !== undefined || this.closed) return

    this.watcher = watch(this.directory, { persistent: true })

    this.watcher.on('change', (_type, filename) => {
      // Some platforms don't always provide the filename: we don't know what changed, so list the directory instead
      if (!filename) this.reconcileRequested = true
      else if (this.filter(filename.toString())) {
        this.pendingFilenames.add(filename.toString())
        this.osEventSinceLastReconcile = true
      } else return

      // Process already handles promise rejection
      void this.process()
    })

    this.watcher.on('error', err => this.emit('error', err))

    this.reconcileTimer = setInterval(() => {
      // The OS watcher is doing its job: don't list the whole directory on every tick, BUSY_RECONCILE_INTERVAL is
      // enough to recover the events it may have dropped anyway
      if (this.osEventSinceLastReconcile && Date.now() - this.lastReconcileDate < BUSY_RECONCILE_INTERVAL) return

      this.reconcileRequested = true
      void this.process()
    }, RECONCILE_INTERVAL)

    // The OS watcher already keeps the event loop alive: don't let a forgotten watcher hold the process
    this.reconcileTimer.unref()

    // Default reconcileRequested is true, so this lists the directory and emits an 'add' for the files it already contains
    // It runs *after* the OS watcher was installed, so we can't miss a file created in between
    void this.process()
  }

  // List the whole directory and emit the events of the files the OS watcher never notified us about
  // Resolves once every file we know about has been emitted, so callers can rely on having seen everything
  async flush () {
    this.reconcileRequested = true

    // Process until nothing is left to process
    while (!this.closed && (this.reconcileRequested || this.pendingFilenames.size !== 0)) {
      await this.process()
    }
  }

  // Resolves once the checks that were already running have finished, so the caller can touch the directory
  close () {
    if (this.closePromise !== undefined) return this.closePromise

    this.closed = true

    clearInterval(this.reconcileTimer)

    this.watcher?.close()
    this.watcher = undefined

    this.closePromise = this.processingPromise ?? Promise.resolve()

    return this.closePromise
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  // Check the pending filenames one at a time, so we always emit the events of a directory in order
  private process () {
    if (this.processingPromise !== undefined) return this.processingPromise

    this.processingPromise = this.processPending()
      .catch(err => {
        this.emit('error', err)
      })
      .finally(() => {
        this.processingPromise = undefined
      })

    return this.processingPromise
  }

  private async processPending () {
    while (!this.closed && (this.reconcileRequested || this.pendingFilenames.size !== 0)) {
      if (this.reconcileRequested) {
        this.reconcileRequested = false

        await this.runStep(() => this.reconcile())
        continue
      }

      const filename = this.pendingFilenames.values().next().value
      this.pendingFilenames.delete(filename)

      await this.runStep(() => this.checkFilename(filename))
    }
  }

  // A file we cannot stat, or a listing we cannot read, must not abandon the events we still have to emit:
  // report the error and carry on with the next filename
  private async runStep (step: () => Promise<void>) {
    try {
      await step()
    } catch (err) {
      this.emit('error', err)
    }
  }

  private async checkFilename (filename: string) {
    if (await this.exists(join(this.directory, filename))) this.emitAdd(filename)
    else this.emitUnlink(filename)
  }

  // Contrary to chokidar we don't stat the entries, so this stays cheap even on a directory that holds thousands of files
  private async reconcile () {
    this.lastReconcileDate = Date.now()
    this.osEventSinceLastReconcile = false

    let filenames: string[]

    try {
      filenames = (await readdir(this.directory)).filter(f => this.filter(f))
    } catch (err) {
      // The directory was removed: there is nothing left to reconcile
      if (err.code === 'ENOENT') return

      throw err
    }

    // The listing is more up to date than the individual checks we had queued, so drop the filenames it contains
    // We keep the others: they may have been created after the listing, and we still have to check them
    for (const filename of filenames) {
      this.pendingFilenames.delete(filename)
    }

    const added = filenames.filter(f => !this.knownFilenames.has(f))
    for (const filename of added.sort(this.sort)) {
      this.emitAdd(filename)
    }

    const current = new Set(filenames)
    // Iterate a copy: emitUnlink() removes the filename from the set
    for (const filename of Array.from(this.knownFilenames)) {
      if (!current.has(filename)) this.emitUnlink(filename)
    }
  }

  private emitAdd (filename: string) {
    if (this.closed) return
    if (this.knownFilenames.has(filename)) return

    this.knownFilenames.add(filename)
    this.emit('add', join(this.directory, filename))
  }

  private emitUnlink (filename: string) {
    if (this.closed) return
    if (!this.knownFilenames.delete(filename)) return

    this.emit('unlink', join(this.directory, filename))
  }

  private async exists (path: string) {
    try {
      await stat(path)

      return true
    } catch (err) {
      if (err.code === 'ENOENT') return false

      throw err
    }
  }
}

export {
  DirectoryWatcher
}
