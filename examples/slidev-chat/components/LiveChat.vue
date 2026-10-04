<script setup>
import CheckHenChat from '@checkhen/slidev-chat'

const server = import.meta.env.VITE_CHECKHEN_URL || 'http://localhost:3000'
const ticket = new URLSearchParams(window.location.search).get('ticket') || ''
</script>

<template>
  <CheckHenChat :server="server" :ticket="ticket" />
</template>
