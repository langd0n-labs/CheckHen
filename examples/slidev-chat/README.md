# Slidev live chat example

1. Set `VITE_CHECKHEN_URL` to the classroom app URL. Without it the deck uses its
   own origin, which is right when CheckHen serves the deck (the demo lecture).
2. Set the app and socket server's `SLIDEV_ORIGIN` to this deck's origin.
3. Run `npm install` and `npm run dev` in this directory.
4. In the instructor dashboard, select the class and choose **Copy Slidev token**.
5. Open the deck URL with `?ticket=<copied token>`.

The [local Slidev component](../../packages/slidev-chat/src/CheckHenChat.vue)
uses the projection API and socket notifications. It renders anonymous names
only. The token expires when the class ends or after four hours, whichever
comes first.

`demo-lecture.md` is a short pretend lecture with the chat on three slides. A hosted
demo serves it at `/deck/`, and the dashboard's **Open demo lecture** opens it with a
ticket for the current session. The deck keeps the ticket for the browser tab, so the
chat works on any slide.
