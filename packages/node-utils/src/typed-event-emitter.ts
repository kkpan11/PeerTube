import { EventEmitter } from 'events'

// EventEmitter that types its event names and the arguments of their listeners
// Extend it instead of repeating the class/interface declaration merging a typed emitter would otherwise need
// Every method that takes an event name is overridden, so none of them can be called with an unknown event
export class TypedEventEmitter<Events extends Record<keyof Events, (...args: any[]) => void>> extends EventEmitter {
  on<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.on(event, listener)
  }

  addListener<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.addListener(event, listener)
  }

  once<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.once(event, listener)
  }

  prependListener<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.prependListener(event, listener)
  }

  prependOnceListener<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.prependOnceListener(event, listener)
  }

  off<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.off(event, listener)
  }

  removeListener<U extends keyof Events & string> (event: U, listener: Events[U]): this {
    return super.removeListener(event, listener)
  }

  removeAllListeners<U extends keyof Events & string> (event?: U): this {
    return super.removeAllListeners(event)
  }

  listeners<U extends keyof Events & string> (event: U): Events[U][] {
    return super.listeners(event) as Events[U][]
  }

  rawListeners<U extends keyof Events & string> (event: U): Events[U][] {
    return super.rawListeners(event) as Events[U][]
  }

  listenerCount<U extends keyof Events & string> (event: U, listener?: Events[U]): number {
    return super.listenerCount(event, listener)
  }

  emit<U extends keyof Events & string> (event: U, ...args: Parameters<Events[U]>): boolean {
    return super.emit(event, ...args)
  }
}
