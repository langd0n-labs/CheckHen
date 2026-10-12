// Where the chat comes from, for the in-slide chat and the panel alike.

// Served by CheckHen itself (the demo lecture), the deck talks to its own origin.
export const chatServer = import.meta.env.VITE_CHECKHEN_URL || window.location.origin

// setup/main.ts keeps the ticket from the opening URL for the browser tab.
let stored = ''
try {
  stored = sessionStorage.getItem('checkhen.ticket') || ''
} catch {
  stored = ''
}
export const chatTicket = new URLSearchParams(window.location.search).get('ticket') || stored
