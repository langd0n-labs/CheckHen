<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { io } from 'socket.io-client'
import { followChat } from './feed.mjs'

const props = defineProps({
  server: { type: String, required: true },
  ticket: { type: String, required: true },
})
const messages = ref([])
const error = ref('')
let stop = () => {}

function connect() {
  stop()
  if (!props.ticket) { error.value = 'Open this deck with a projection ticket.'; return }
  stop = followChat({ server: props.server, ticket: props.ticket, connectSocket: io, fetchImpl: fetch,
    onMessages: value => { messages.value = value; error.value = '' },
    onError: () => { error.value = 'Projection access expired. Get a new token from the instructor.' },
  })
}
onMounted(connect)
watch(() => [props.server, props.ticket], connect)
onUnmounted(() => stop())
</script>

<template>
  <section class="checkhen-chat" aria-label="Live class discussion">
    <p v-if="error" role="alert">{{ error }}</p>
    <article v-for="message in messages" :key="message.id" class="checkhen-message">
      <strong>{{ message.anonymousName }}</strong>
      <p>{{ message.message }}</p>
    </article>
  </section>
</template>

<style scoped>
.checkhen-chat { display: grid; gap: 1rem; max-height: 75vh; overflow-y: auto; }
.checkhen-message { padding: 1rem; border-radius: .75rem; background: #223149; color: white; }
.checkhen-message p { margin: .5rem 0 0; }
</style>
