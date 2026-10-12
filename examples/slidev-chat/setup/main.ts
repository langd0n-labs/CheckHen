// Keep the projection ticket from the opening URL: moving between slides drops the
// query string, and the chat may be on a later slide.
export default function setup() {
  const ticket = new URLSearchParams(window.location.search).get('ticket')
  if (ticket) {
    try {
      sessionStorage.setItem('checkhen.ticket', ticket)
    } catch {
      // Without storage the chat still works on the slide the deck opened on.
    }
  }
}
