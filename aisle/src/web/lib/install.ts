import { observable, useObservable } from './observable'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = observable<InstallPromptEvent | null>(null)

/** Chrome and Edge offer installing through an event that has to be caught early and kept. */
export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred.set(event as InstallPromptEvent)
  })
  window.addEventListener('appinstalled', () => deferred.set(null))
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useInstall(): { canPrompt: boolean; prompt: () => Promise<void> } {
  const event = useObservable(deferred)
  return {
    canPrompt: event !== null,
    prompt: async () => {
      if (!event) return
      await event.prompt()
      await event.userChoice.catch(() => undefined)
      deferred.set(null)
    },
  }
}
