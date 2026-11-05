<script setup>
import { computed, watchEffect } from 'vue'
import { useNav } from '@slidev/client'
import CheckHenChatPanel from '@checkhen/slidev-chat/panel'
import { chatServer, chatTicket, collapseWithoutTicket } from './chat-config.js'

// The class chat runs down the right side of every slide. A slide hides it with
// `chat: false` in its frontmatter; the panel stays connected while hidden. A PDF or
// print export never shows it, because a printed page cannot show a live chat.
const { currentSlideRoute, isPrintMode } = useNav()
const shown = computed(() =>
  currentSlideRoute.value?.meta?.slide?.frontmatter?.chat !== false &&
  !isPrintMode.value &&
  !(collapseWithoutTicket && !chatTicket))
watchEffect(() => document.documentElement.classList.toggle('checkhen-chat-hidden', !shown.value))
</script>

<template>
  <CheckHenChatPanel v-show="shown" :server="chatServer" :ticket="chatTicket" />
</template>
