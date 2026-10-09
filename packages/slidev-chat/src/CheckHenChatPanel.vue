<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { io } from 'socket.io-client'
import { followChat } from './feed.mjs'

// A stream-style chat strip: newest line at the bottom, older lines scroll off the
// top, no animation. Use it from a Slidev global layer so it stays on every slide.
const props = defineProps({
  server: { type: String, required: true },
  ticket: { type: String, required: true },
})
const messages = ref([])
const error = ref('')
let stop = () => {}

function connect() {
  stop()
  if (!props.ticket) { error.value = 'Open this deck from the dashboard to show the class chat.'; return }
  stop = followChat({ server: props.server, ticket: props.ticket, connectSocket: io, fetchImpl: fetch,
    onMessages: value => { messages.value = value; error.value = '' },
    onError: () => { error.value = 'Chat access expired. Open the deck again from the dashboard.' },
  })
}
onMounted(connect)
watch(() => [props.server, props.ticket], connect)
onUnmounted(() => stop())

// Each anonymous name keeps one color, so a reader can follow a thread.
const colors = ['#8ab4ff', '#ffb38a', '#9be29b', '#f59ad8', '#ffd96b', '#7fe0e0', '#c9a7ff', '#ff9a9a']
function color(name) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return colors[hash % colors.length]
}
</script>

<template>
  <aside class="checkhen-panel" aria-label="Class chat" aria-live="polite">
    <h2 class="checkhen-panel-title">Class chat</h2>
    <div class="checkhen-panel-feed">
      <p v-if="error" class="checkhen-panel-note" role="alert">{{ error }}</p>
      <p v-else-if="!messages.length" class="checkhen-panel-note">No messages yet.</p>
      <p v-for="message in messages" :key="message.id" class="checkhen-panel-line">
        <strong :style="{ color: color(message.anonymousName) }">{{ message.anonymousName }}</strong>
        {{ message.message }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
.checkhen-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 15%;
  display: flex;
  flex-direction: column;
  background: #18181f;
  color: #ececf1;
  font-size: 0.8rem;
  line-height: 1.35;
  z-index: 10;
}
.checkhen-panel-title {
  margin: 0;
  padding: 0.6rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  border-bottom: 1px solid #2c2c36;
}
/* Lines stack from the bottom; whatever no longer fits is clipped at the top. */
.checkhen-panel-feed {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  padding: 0.5rem 0.75rem;
  gap: 0.35rem;
}
.checkhen-panel-line {
  margin: 0;
  overflow-wrap: anywhere;
}
.checkhen-panel-line strong {
  margin-right: 0.3rem;
}
.checkhen-panel-note {
  margin: 0;
  color: #9a9aa8;
}
</style>
