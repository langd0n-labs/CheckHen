<script setup>
import CheckHenChat from '@checkhen/slidev-chat'

// Served by CheckHen itself (the demo lecture), the deck talks to its own origin.
const server = import.meta.env.VITE_CHECKHEN_URL || window.location.origin
let stored = ''
try {
  stored = sessionStorage.getItem('checkhen.ticket') || ''
} catch {
  stored = ''
}
const ticket = new URLSearchParams(window.location.search).get('ticket') || stored
</script>

<template>
  <CheckHenChat :server="server" :ticket="ticket" />
</template>
