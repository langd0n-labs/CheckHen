<script setup>
import CheckHenChat from '@checkhen/slidev-chat'
import { chatServer, chatTicket } from '../chat-config.js'
</script>

<template>
  <CheckHenChat :server="chatServer" :ticket="chatTicket" />
</template>
